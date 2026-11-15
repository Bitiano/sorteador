import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDraw, deliverySummary } from './draw.js';

const root = dirname(fileURLToPath(import.meta.url));
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

function emailText(draw, delivery) {
  return `Olá, ${delivery.giver.name}!\n\nO sorteio de ${draw.eventName} foi realizado. Você vai presentear: ${delivery.receiver.name}.\n\nGuarde segredo para manter a surpresa!\n`;
}

export async function sendPending(draw, sendEmail) {
  for (const delivery of draw.deliveries) {
    if (delivery.status === 'sent' || delivery.status === 'uncertain') continue;
    try {
      await sendEmail(draw, delivery);
      delivery.status = 'sent';
    } catch (error) {
      delivery.status = error.uncertain ? 'uncertain' : 'failed';
      return { error: error.message, summary: deliverySummary(draw) };
    }
  }
  return { summary: deliverySummary(draw) };
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
    throw new Error(`Brevo recusou o envio (${response.status}). Verifique a chave, o remetente e a cota diária.`);
  }
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};

await loadEnv();
const port = Number(process.env.PORT || 3000);
const draws = new Map();
const active = new Set();

async function deliver(draw) {
  const result = await sendPending(draw, brevoSend);
  if (result.summary.pending === 0) draws.delete(draw.id);
  return { ...result, retryId: result.summary.pending ? draw.id : null };
}

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
      if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
        return json(response, 503, { error: 'Configure BREVO_API_KEY e BREVO_SENDER_EMAIL no arquivo .env e reinicie o servidor.' });
      }
      const draw = createDraw(await readJson(request));
      draws.set(draw.id, draw);
      const result = await deliver(draw);
      return json(response, result.error ? 502 : 200, result);
    }
    const match = url.pathname.match(/^\/api\/sorteios\/([0-9a-f-]{36})\/enviar$/);
    if (match && request.method === 'POST') {
      if (active.has(match[1])) return json(response, 409, { error: 'O envio já está em andamento.' });
      const draw = draws.get(match[1]);
      if (!draw) return json(response, 404, { error: 'Sorteio não disponível. Ele não é salvo e pode ter sido perdido após reiniciar o servidor.' });
      active.add(match[1]);
      try {
        const result = await deliver(draw);
        return json(response, result.error ? 502 : 200, result);
      } finally { active.delete(match[1]); }
    }
    const discard = url.pathname.match(/^\/api\/sorteios\/([0-9a-f-]{36})\/descartar$/);
    if (discard && request.method === 'POST') {
      if (active.has(discard[1])) return json(response, 409, { error: 'O envio ainda está em andamento.' });
      draws.delete(discard[1]);
      return json(response, 200, { discarded: true });
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
