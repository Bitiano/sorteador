import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraw, publicDraw, validateDraw } from './draw.js';
import { sendPending } from './server.js';

const participants = [
  { name: 'Ana', email: 'ana@example.com' },
  { name: 'Bia', email: 'bia@example.com' },
  { name: 'Caio', email: 'caio@example.com' },
  { name: 'Davi', email: 'davi@example.com' }
];

test('forma uma única roda e a primeira pessoa é a última a receber', () => {
  const draw = createDraw({ eventName: 'Natal', participants, firstEmail: 'bia@example.com' }, () => 0);
  assert.equal(draw.deliveries[0].giver.name, 'Bia');
  assert.equal(draw.deliveries.at(-1).receiver.name, 'Bia');
  assert.equal(new Set(draw.deliveries.map((item) => item.giver.email)).size, 4);
  assert.equal(new Set(draw.deliveries.map((item) => item.receiver.email)).size, 4);
  for (let i = 0; i < draw.deliveries.length; i++) {
    assert.notEqual(draw.deliveries[i].giver.email, draw.deliveries[i].receiver.email);
    assert.equal(draw.deliveries[i].receiver.email, draw.deliveries[(i + 1) % 4].giver.email);
  }
  assert.ok(!JSON.stringify(publicDraw(draw)).includes('receiver'));
});

test('rejeita e-mails repetidos e menos de três participantes', () => {
  assert.throws(() => validateDraw({ eventName: 'Natal', participants: participants.slice(0, 2) }), /3 a 300/);
  assert.throws(() => validateDraw({ eventName: 'Natal', participants: [...participants.slice(0, 3), { name: 'Eva', email: 'ANA@example.com' }] }), /e-mail/);
});

test('retoma o mesmo sorteio sem reenviar para quem já recebeu', async () => {
  const draw = createDraw({ eventName: 'Natal', participants }, () => 0);
  const sent = [];
  let fail = true;
  const sendEmail = async (_draw, delivery) => {
    sent.push(delivery.giver.email);
    if (fail && sent.length === 2) throw new Error('Falha simulada');
    return `id-${sent.length}`;
  };
  const first = await sendPending(draw, sendEmail, async () => {});
  assert.equal(first.error, 'Falha simulada');
  assert.equal(draw.deliveries[0].status, 'sent');
  assert.equal(draw.deliveries[1].status, 'failed');
  fail = false;
  const second = await sendPending(draw, sendEmail, async () => {});
  assert.equal(second.error, undefined);
  assert.equal(sent.filter((email) => email === draw.deliveries[0].giver.email).length, 1);
  assert.ok(draw.deliveries.every((item) => item.status === 'sent'));
});
