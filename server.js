import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDraw, publicDraw } from './draw.js';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, '.data');
const publicDir = join(root, 'public');

async function loadEnv() {
  try {
    const content = await readFile(join(root, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2').trim();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Envie dados em JSON.'), { status: 415 });
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error('Lista grande demais.'), { status: 413 });
  }
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

function drawPath(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('Sorteio não encontrado.'), { status: 404 });
  return join(dataDir, `${id}.json`);
}

async function readDraw(id) {
  try { return JSON.parse(await readFile(drawPath(id), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Sorteio não encontrado.'), { status: 404 });
    throw error;
  }
}

async function saveDraw(draw) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(drawPath(draw.id), JSON.stringify(draw, null, 2), { flag: 'w' });
}

function emailText(draw, delivery) {
  return `Olá, ${delivery.giver.name}!\n\nO sorteio de ${draw.eventName} foi realizado. Você vai presentear: ${delivery.receiver.name}.\n\nGuarde segredo para manter a surpresa!\n`;
}

export async function sendPending(draw, sendEmail, persist = saveDraw) {
  for (const delivery of draw.deliveries) {
    if (delivery.status === 'sent' || delivery.status === 'uncertain') continue;
    try {
      const messageId = await sendEmail(draw, delivery);
      delivery.status = 'sent';
      delivery.messageId = messageId;
      await persist(draw);
    } catch (error) {
      delivery.status = error.uncertain ? 'uncertain' : 'failed';
      await persist(draw);
      return { error: error.message, draw: publicDraw(draw) };
    }
  }
  return { draw: publicDraw(draw) };
}

async function brevoSend(draw, delivery) {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    throw new Error('Configure BREVO_API_KEY e BREVO_SENDER_EMAIL no arquivo .env.');
  }
  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'Inimigo Secreto' },
        to: [{ email: delivery.giver.email, name: delivery.giver.name }],
        subject: `Seu inimigo secreto — ${draw.eventName}`,
        textContent: emailText(draw, delivery)
      }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw Object.assign(new Error('Não foi possível confirmar o envio. Confira o histórico na Brevo antes de tentar novamente.'), { uncertain: true });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Brevo recusou o envio (${response.status}): ${String(detail.message || 'verifique a chave, o remetente e a cota diária').slice(0, 180)}`);
  }
  const result = await response.json().catch(() => ({}));
  return result.messageId || 'aceito';
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};

await loadEnv();
const port = Number(process.env.PORT || 3000);
const active = new Set();
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && files[url.pathname]) {
      const [file, type] = files[url.pathname];
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(await readFile(join(publicDir, file)));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return json(response, 403, { error: 'Origem não permitida.' });
    }
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return json(response, 200, { configured: Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) });
    }
    if (request.method === 'POST' && url.pathname === '/api/sorteios') {
      const draw = createDraw(await readJson(request));
      await saveDraw(draw);
      return json(response, 201, { draw: publicDraw(draw) });
    }
    const match = url.pathname.match(/^\/api\/sorteios\/([0-9a-f-]{36})(\/enviar)?$/);
    if (match && request.method === 'GET' && !match[2]) {
      return json(response, 200, { draw: publicDraw(await readDraw(match[1])) });
    }
    if (match && request.method === 'POST' && match[2]) {
      if (active.has(match[1])) return json(response, 409, { error: 'O envio já está em andamento.' });
      active.add(match[1]);
      try {
        const result = await sendPending(await readDraw(match[1]), brevoSend);
        return json(response, result.error ? 502 : 200, result);
      } finally { active.delete(match[1]); }
    }
    json(response, 404, { error: 'Página não encontrada.' });
  } catch (error) {
    const status = error.status || (error.code ? 500 : 400);
    json(response, status, { error: status === 500 ? 'Erro interno.' : error.message });
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, '127.0.0.1', () => console.log(`Sorteador em http://127.0.0.1:${port}`));
}

export { server };
