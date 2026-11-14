import { randomInt, randomUUID } from 'node:crypto';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateDraw(input) {
  if (!input || typeof input !== 'object') throw new Error('Informe os dados do sorteio.');
  const eventName = String(input.eventName ?? '').trim();
  if (!eventName || eventName.length > 100) throw new Error('O nome do evento deve ter até 100 caracteres.');
  if (!Array.isArray(input.participants) || input.participants.length < 3 || input.participants.length > 300) {
    throw new Error('Inclua de 3 a 300 participantes.');
  }

  const participants = input.participants.map((item) => ({
    name: String(item?.name ?? '').trim(),
    email: String(item?.email ?? '').trim().toLowerCase()
  }));
  for (const person of participants) {
    if (!person.name || person.name.length > 80) throw new Error('Cada participante precisa de um nome de até 80 caracteres.');
    if (!EMAIL.test(person.email) || person.email.length > 254) throw new Error('Confira os e-mails dos participantes.');
  }
  if (new Set(participants.map((p) => p.email)).size !== participants.length) {
    throw new Error('Cada e-mail pode aparecer apenas uma vez.');
  }
  if (new Set(participants.map((p) => p.name.toLocaleLowerCase('pt-BR'))).size !== participants.length) {
    throw new Error('Use nomes diferentes para evitar dúvidas no presente.');
  }

  const firstEmail = String(input.firstEmail ?? '').trim().toLowerCase();
  if (firstEmail && !participants.some((p) => p.email === firstEmail)) {
    throw new Error('A pessoa que começa precisa estar na lista.');
  }
  return { eventName, participants, firstEmail };
}

export function createDraw(input, random = randomInt) {
  const { eventName, participants, firstEmail } = validateDraw(input);
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (firstEmail) {
    const index = shuffled.findIndex((p) => p.email === firstEmail);
    shuffled.push(...shuffled.splice(0, index));
  }

  return {
    id: randomUUID(),
    eventName,
    createdAt: new Date().toISOString(),
    deliveries: shuffled.map((giver, index) => ({
      giver,
      receiver: shuffled[(index + 1) % shuffled.length],
      status: 'pending',
      messageId: null
    }))
  };
}

export function publicDraw(draw) {
  return {
    id: draw.id,
    eventName: draw.eventName,
    createdAt: draw.createdAt,
    firstGiver: draw.deliveries[0].giver.name,
    deliveries: draw.deliveries.map(({ giver, status }) => ({
      name: giver.name,
      email: giver.email,
      status
    }))
  };
}
