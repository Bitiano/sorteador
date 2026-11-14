const $ = (selector) => document.querySelector(selector);
const participants = $('#participants');
const firstPerson = $('#first-person');
let currentDrawId = localStorage.getItem('secretDrawId');
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

function renderDraw(draw, error = '') {
  $('#workspace').hidden = true;
  $('#result').hidden = false;
  $('#result-subtitle').textContent = `${draw.eventName} · ${draw.deliveries.length} participantes · começa com ${draw.firstGiver}`;
  const list = $('#delivery-list');
  list.replaceChildren();
  const labels = { sent: 'E-mail aceito ✓', pending: 'Pendente', failed: 'Falhou', uncertain: 'Envio incerto' };
  for (const item of draw.deliveries) {
    const row = document.createElement('div');
    row.className = 'delivery-row';
    const person = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'delivery-name';
    name.textContent = item.name;
    const email = document.createElement('div');
    email.className = 'delivery-email';
    email.textContent = item.email;
    person.append(name, email);
    const status = document.createElement('span');
    status.className = `status ${item.status}`;
    status.textContent = labels[item.status] || item.status;
    row.append(person, status);
    list.append(row);
  }
  const sent = draw.deliveries.filter((item) => item.status === 'sent').length;
  const retry = draw.deliveries.some((item) => item.status === 'pending' || item.status === 'failed');
  $('#retry-button').hidden = !retry;
  const uncertain = draw.deliveries.some((item) => item.status === 'uncertain');
  showMessage($('#result-message'), error || (uncertain ? 'Há um envio incerto. Confira o histórico na Brevo antes de criar outro sorteio; esta pessoa não será reenviada automaticamente.' : sent === draw.deliveries.length ? 'Todos os e-mails foram aceitos pela Brevo.' : ''), !error && !uncertain && sent === draw.deliveries.length);
}

async function send(drawId) {
  busy = true;
  $('#draw-button').disabled = true;
  $('#retry-button').disabled = true;
  $('#draw-button').textContent = 'Enviando e-mails…';
  $('#retry-button').textContent = 'Enviando…';
  showMessage($('#message'), 'Enviando os resultados individualmente. Aguarde nesta página.', true);
  try {
    const result = await api(`/api/sorteios/${drawId}/enviar`, { method: 'POST' });
    renderDraw(result.draw);
  } catch (error) {
    if (error.data?.draw) renderDraw(error.data.draw, error.message);
    else showMessage($('#result').hidden ? $('#message') : $('#result-message'), error.message);
  } finally {
    busy = false;
    $('#draw-button').disabled = false;
    $('#retry-button').disabled = false;
    $('#draw-button').innerHTML = 'Sortear e enviar e-mails <span aria-hidden="true">↗</span>';
    $('#retry-button').innerHTML = 'Tentar enviar os pendentes <span aria-hidden="true">↗</span>';
  }
}

$('#draw-button').addEventListener('click', async () => {
  if (busy) return;
  const eventName = $('#event-name').value.trim();
  const people = [...participants.querySelectorAll('.person-row')].map((row) => ({
    name: row.querySelector('.person-name').value.trim(),
    email: row.querySelector('.person-email').value.trim()
  }));
  if (!eventName || people.some((person) => !person.name || !person.email)) return showMessage($('#message'), 'Preencha o nome do evento e todos os participantes.');
  try {
    $('#draw-button').disabled = true;
    const { draw } = await api('/api/sorteios', { method: 'POST', body: JSON.stringify({ eventName, participants: people, firstEmail: firstPerson.value }) });
    currentDrawId = draw.id;
    localStorage.setItem('secretDrawId', currentDrawId);
    renderDraw(draw);
    await send(currentDrawId);
  } catch (error) {
    showMessage($('#message'), error.message);
    $('#draw-button').disabled = false;
  }
});

$('#retry-button').addEventListener('click', () => { if (!busy && currentDrawId) send(currentDrawId); });
$('#new-button').addEventListener('click', () => {
  currentDrawId = null;
  localStorage.removeItem('secretDrawId');
  $('#result').hidden = true;
  $('#workspace').hidden = false;
  showMessage($('#message'), '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#add-person').addEventListener('click', () => addPerson());
addPerson(); addPerson(); addPerson();

if (currentDrawId) {
  api(`/api/sorteios/${currentDrawId}`).then(({ draw }) => renderDraw(draw)).catch(() => {
    localStorage.removeItem('secretDrawId');
    currentDrawId = null;
  });
}
api('/api/config').then(({ configured }) => {
  if (!configured && !currentDrawId) showMessage($('#message'), 'Antes de enviar, configure sua chave da Brevo e o e-mail remetente no arquivo .env.');
}).catch(() => {});
