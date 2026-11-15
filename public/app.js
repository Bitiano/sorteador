const $ = (selector) => document.querySelector(selector);
const participants = $('#participants');
const firstPerson = $('#first-person');
localStorage.removeItem('secretDrawId');
let retryId = null;
let busy = false;

function showMessage(target, text, success = false) {
  target.textContent = text;
  target.classList.toggle('success', success);
  target.hidden = !text;
}

function addPerson(name = '', email = '') {
  const row = document.createElement('div');
  row.className = 'person-row';
  row.innerHTML = '<input class="person-name" type="text" maxlength="80" placeholder="Nome" aria-label="Nome do participante" required><input class="person-email" type="email" maxlength="254" placeholder="email@exemplo.com" aria-label="E-mail do participante" required><button class="remove-button" type="button" aria-label="Remover participante">×</button>';
  row.querySelector('.person-name').value = name;
  row.querySelector('.person-email').value = email;
  row.querySelector('.remove-button').addEventListener('click', () => {
    if (participants.children.length <= 3) return showMessage($('#message'), 'O sorteio precisa de pelo menos 3 pessoas.');
    row.remove();
    updatePeople();
  });
  row.querySelectorAll('input').forEach((input) => input.addEventListener('input', updatePeople));
  participants.append(row);
  updatePeople();
}

function updatePeople() {
  const selected = firstPerson.value;
  const rows = [...participants.querySelectorAll('.person-row')];
  $('#participant-count').textContent = rows.length;
  firstPerson.innerHTML = '<option value="">Escolher aleatoriamente</option>';
  for (const row of rows) {
    const name = row.querySelector('.person-name').value.trim();
    const email = row.querySelector('.person-email').value.trim().toLowerCase();
    if (!name || !email) continue;
    const option = document.createElement('option');
    option.value = email;
    option.textContent = name;
    firstPerson.append(option);
  }
  firstPerson.value = [...firstPerson.options].some((option) => option.value === selected) ? selected : '';
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Ocorreu um erro.'), { data });
  return data;
}

function showOutcome(result, error = '') {
  const summary = result.summary;
  retryId = result.retryId || null;
  $('#retry-button').hidden = !retryId;
  $('#new-button').hidden = false;
  $('#draw-button').disabled = true;
  let message = `${summary.sent} de ${summary.total} e-mails aceitos pela Brevo.`;
  if (error) message += ` ${error}`;
  if (summary.uncertain) message += ' Há envio incerto: confira o histórico na Brevo antes de iniciar outro sorteio.';
  if (retryId) message += ' O sorteio permanece apenas na memória do servidor enquanto ele estiver ligado; use o botão abaixo para tentar os pendentes.';
  if (!error && !summary.uncertain) message += ' Nenhum resultado foi salvo no computador.';
  showMessage($('#message'), message, !error && !summary.uncertain);
}

async function send(path, body) {
  busy = true;
  $('#draw-button').disabled = true;
  $('#retry-button').disabled = true;
  $('#draw-button').textContent = 'Enviando e-mails…';
  showMessage($('#message'), 'Enviando os resultados individualmente. Aguarde nesta página.', true);
  try {
    const result = await api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    showOutcome(result);
  } catch (error) {
    if (error.data?.summary) showOutcome(error.data, error.message);
    else showMessage($('#message'), `${error.message} Se o envio foi iniciado, confira o histórico na Brevo antes de sortear novamente.`);
  } finally {
    busy = false;
    if (!$('#new-button').hidden) $('#draw-button').disabled = true;
    else $('#draw-button').disabled = false;
    $('#retry-button').disabled = false;
    $('#draw-button').innerHTML = 'Sortear e enviar e-mails <span aria-hidden="true">↗</span>';
  }
}

$('#draw-button').addEventListener('click', () => {
  if (busy) return;
  const eventName = $('#event-name').value.trim();
  const people = [...participants.querySelectorAll('.person-row')].map((row) => ({
    name: row.querySelector('.person-name').value.trim(),
    email: row.querySelector('.person-email').value.trim()
  }));
  if (!eventName || people.some((person) => !person.name || !person.email)) return showMessage($('#message'), 'Preencha o nome do evento e todos os participantes.');
  send('/api/sorteios', { eventName, participants: people, firstEmail: firstPerson.value });
});

$('#retry-button').addEventListener('click', () => { if (!busy && retryId) send(`/api/sorteios/${retryId}/enviar`); });
$('#new-button').addEventListener('click', async () => {
  if (busy) return;
  if (retryId) await api(`/api/sorteios/${retryId}/descartar`, { method: 'POST' }).catch(() => {});
  retryId = null;
  $('#event-name').value = '';
  participants.replaceChildren();
  addPerson(); addPerson(); addPerson();
  $('#retry-button').hidden = true;
  $('#new-button').hidden = true;
  $('#draw-button').disabled = false;
  showMessage($('#message'), '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#add-person').addEventListener('click', () => addPerson());
addPerson(); addPerson(); addPerson();

api('/api/config').then(({ configured }) => {
  if (!configured) showMessage($('#message'), 'Antes de enviar, configure sua chave da Brevo e o e-mail remetente no arquivo .env.');
}).catch(() => {});
