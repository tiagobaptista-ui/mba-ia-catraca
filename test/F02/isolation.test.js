import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED } from '../helpers/index.js';
import {
  listOrganizerEvents,
  getOwnedEvent,
  updateEvent,
  publishEvent,
} from '../../src/modules/events/service.js';
import { eventInput, createEventVia, eventRow, countEvents, mainText } from './support.js';

const app = useTestApp({ workers: false });

async function login(email) {
  const c = createClient(app.baseUrl);
  await c.login(email);
  return c;
}

test('F02-CA06 (R13): organizador B não vê os eventos de A na lista', async () => {
  const a = await login(SEED.organizerA);
  const b = await login(SEED.organizerB);
  const idA = await createEventVia(a, { name: 'Somente de A' });
  const idB = await createEventVia(b, { name: 'Somente de B' });

  const listB = await b.get('/organizer');
  assert.equal(listB.status, 200);
  assert.doesNotMatch(listB.text, /Somente de A/);
  assert.doesNotMatch(listB.text, new RegExp(idA));
  assert.match(listB.text, /Somente de B/);

  const fromService = await listOrganizerEvents(app.users.organizerB.id);
  assert.ok(fromService.every((e) => e.organizerId === app.users.organizerB.id));
  assert.ok(fromService.some((e) => e.id === idB));
  assert.equal(await getOwnedEvent(app.users.organizerB.id, idA), null);
});

test('F02-CA06 (R13): GET e POST na gestão de A pelo organizador B respondem 404 sem dados de A', async () => {
  const a = await login(SEED.organizerA);
  const b = await login(SEED.organizerB);
  const id = await createEventVia(a, { name: 'Jazz de A', venue: 'Porão de A', capacity: '42', price: '99,00' });
  const before = await eventRow(id);

  const responses = [
    await b.get(`/organizer/events/${id}`),
    await b.post(`/organizer/events/${id}`, eventInput({ name: 'Tomado por B', capacity: '1', price: '1,00' })),
    await b.post(`/organizer/events/${id}/publish`, {}),
  ];
  for (const res of responses) {
    assert.equal(res.status, 404);
    assert.match(res.text, /Evento não encontrado/);
    assert.doesNotMatch(res.text, /Jazz de A|Porão de A|99,00|Tomado por B/);
    assert.doesNotMatch(mainText(res.text), /\d/, 'nenhum número do evento no corpo');
  }
  assert.deepEqual(await eventRow(id), before);

  // o serviço aplica a mesma regra
  const orgB = app.users.organizerB.id;
  assert.deepEqual(await updateEvent(orgB, id, eventInput({ name: 'Tomado por B' })), { notFound: true });
  assert.deepEqual(await publishEvent(orgB, id), { notFound: true });
  assert.deepEqual(await eventRow(id), before);

  // e o dono continua operando normalmente
  assert.equal((await a.get(`/organizer/events/${id}`)).status, 200);
});

test('X01 (R13): organizador A da seed entra e /organizer lista só os eventos dele', async () => {
  const b = await login(SEED.organizerB);
  await createEventVia(b, { name: 'Evento X01 de B' });

  const a = createClient(app.baseUrl);
  const res = await a.login(SEED.organizerA);
  assert.equal(res.status, 302);
  assert.equal(res.location, '/organizer');
  await createEventVia(a, { name: 'Evento X01 de A' });

  const list = await a.get('/organizer');
  assert.equal(list.status, 200);
  assert.match(list.text, /Área do organizador/);
  assert.match(list.text, /Evento X01 de A/);
  assert.doesNotMatch(list.text, /Evento X01 de B/);
  assert.match(list.text, /href="\/organizer\/events\/new"/);
});

test('X01 (R13): participante recebe 403 e visitante vai ao login em /organizer/events/new', async () => {
  const participant = await login(SEED.participant);
  const p = await participant.get('/organizer/events/new');
  assert.equal(p.status, 403);
  assert.match(p.text, /Acesso restrito/);
  assert.doesNotMatch(p.text, /name="capacity"/);

  const before = await countEvents();
  const create = await participant.post('/organizer/events', eventInput({ name: 'Do participante' }));
  assert.equal(create.status, 403);
  assert.equal(await countEvents(), before);

  const visitor = await createClient(app.baseUrl).get('/organizer/events/new');
  assert.equal(visitor.status, 302);
  assert.equal(visitor.location, '/login?next=%2Forganizer%2Fevents%2Fnew');
});

test('R13: participante e visitante também não abrem a gestão de um evento existente', async () => {
  const a = await login(SEED.organizerA);
  const id = await createEventVia(a, { name: 'Gestão fechada' });
  const participant = await login(SEED.participant);
  const p = await participant.get(`/organizer/events/${id}`);
  assert.equal(p.status, 403);
  assert.doesNotMatch(p.text, /Gestão fechada/);
  const v = await createClient(app.baseUrl).get(`/organizer/events/${id}`);
  assert.equal(v.status, 302);
  assert.equal(v.location, `/login?next=${encodeURIComponent(`/organizer/events/${id}`)}`);
});
