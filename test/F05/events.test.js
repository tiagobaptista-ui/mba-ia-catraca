// GET /api/partner/events (F05-CA01, X09, X10): só eventos à venda, no formato do contrato, com o preço atual e as
// vagas de R05. Com o worker do gateway ligado, como no produto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeInDays, SEED, useTestApp } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { toIsoOffset } from '../../src/core/time.js';
import {
  CARD,
  buy,
  cancelViaSql,
  createEventVia,
  eventInput,
  listedEvent,
  loginAs,
  onSaleEvent,
  partnerApi,
  salesExtraOf,
  signupParticipant,
  validBody,
  waitForTicketStatus,
} from './support.js';

const app = useTestApp({ workers: true });

const EVENT_KEYS = ['id', 'name', 'startsAt', 'priceCents', 'availableSeats'];

test('F05-CA01: sem eventos à venda, a listagem é um array vazio em JSON', async () => {
  const res = await partnerApi(app.baseUrl).listEvents();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(res.json, []);
});

test('C04, X09, F05-CA01 (R02): rascunho fica fora; publicado aparece no formato exato do contrato', async () => {
  const api = partnerApi(app.baseUrl);
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const startsAt = localDateTimeInDays(30);
  const e1 = await createEventVia(a, { name: 'Jazz no Porão', capacity: '2', price: '100,00', startsAt }, { publish: false });

  assert.equal(await listedEvent(api, e1), undefined, 'rascunho não aparece');

  const published = await a.post(`/organizer/events/${e1}/publish`, {});
  assert.equal(published.status, 302);
  const res = await api.listEvents();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json));
  const item = res.json.find((e) => e.id === e1);
  assert.ok(item, 'publicado aparece');
  assert.deepEqual(Object.keys(item), EVENT_KEYS);
  const { rows } = await query('SELECT starts_at FROM events WHERE id = $1', [e1]);
  assert.deepEqual(item, {
    id: e1,
    name: 'Jazz no Porão',
    startsAt: toIsoOffset(rows[0].starts_at),
    priceCents: 10000,
    availableSeats: 2,
  });
  // ISO 8601 com offset −03:00, a mesma data/hora informada pelo organizador; ids string, números inteiros.
  assert.match(item.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
  assert.equal(item.startsAt, `${startsAt}:00-03:00`);
  assert.equal(new Date(item.startsAt).getTime(), rows[0].starts_at.getTime());
  assert.match(item.id, /^evt_/);
  assert.ok(Number.isInteger(item.priceCents) && Number.isInteger(item.availableSeats));
  assert.match(res.text, new RegExp(`"priceCents":10000,"availableSeats":2\\}`), 'números, não strings');
});

test('C05, X09 (R03): priceCents acompanha o preço atual depois da edição na gestão', async () => {
  const api = partnerApi(app.baseUrl);
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const startsAt = localDateTimeInDays(30);
  const fields = { name: 'Preço editado', capacity: '2', price: '100,00', startsAt };
  const id = await createEventVia(a, fields);
  assert.equal((await listedEvent(api, id)).priceCents, 10000);

  const edited = await a.post(`/organizer/events/${id}`, eventInput({ ...fields, price: '150,00' }));
  assert.equal(edited.status, 302, edited.text);
  assert.equal((await listedEvent(api, id)).priceCents, 15000);

  const centavos = await a.post(`/organizer/events/${id}`, eventInput({ ...fields, price: '1.234,56' }));
  assert.equal(centavos.status, 302);
  assert.equal((await listedEvent(api, id)).priceCents, 123456);
});

test('C14, X09 (R02): só publicados e não cancelados, de todos os organizadores', async () => {
  const api = partnerApi(app.baseUrl);
  const { organizerA, organizerB } = app.users;
  const draft = await onSaleEvent(organizerA.id, { name: 'Rascunho X09' }, { publish: false });
  const ofA = await onSaleEvent(organizerA.id, { name: 'Publicado A' });
  const ofB = await onSaleEvent(organizerB.id, { name: 'Publicado B' });
  const cancelled = await onSaleEvent(organizerA.id, { name: 'Cancelado X09' });
  assert.ok(await listedEvent(api, cancelled), 'publicado antes de cancelar');
  await cancelViaSql(cancelled);

  const res = await api.listEvents();
  const ids = res.json.map((e) => e.id);
  assert.ok(ids.includes(ofA) && ids.includes(ofB));
  assert.ok(!ids.includes(draft), 'rascunho fora');
  assert.ok(!ids.includes(cancelled), 'cancelado fora');
  const { rows } = await query("SELECT id FROM events WHERE status = 'published' ORDER BY id");
  assert.deepEqual([...ids].sort(), rows.map((r) => r.id), 'exatamente os publicados');
  for (const item of res.json) assert.deepEqual(Object.keys(item), EVENT_KEYS);
});

test('C07, C11, X10 (R05, R08): availableSeats cai com a compra pendente e volta com a recusa', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await onSaleEvent(app.users.organizerA.id, { name: 'Vagas X10', capacity: '2' });
  assert.equal((await listedEvent(api, id)).availableSeats, 2);

  // 0004: recusa lenta (~0,6–0,8 s nos testes): a pendência ocupa vaga até a resposta.
  const pending = await api.purchase(id, validBody({ buyerEmail: 't2@example.com', cardNumber: CARD.declineSlow }));
  assert.equal(pending.status, 202, pending.text);
  assert.equal((await listedEvent(api, id)).availableSeats, 1, 'pendente ocupa vaga');
  assert.equal((await api.ticket(pending.json.ticketId)).json.status, 'pending');

  await waitForTicketStatus(api, pending.json.ticketId, 'declined');
  assert.equal((await listedEvent(api, id)).availableSeats, 2, 'recusa devolve a vaga');

  // Confirmados continuam ocupando: 0001 aprova rápido e a vaga não volta.
  const approved = await api.purchase(id, validBody({ buyerEmail: 't3@example.com', cardNumber: CARD.approve }));
  assert.equal(approved.status, 202);
  await waitForTicketStatus(api, approved.json.ticketId, 'confirmed');
  assert.equal((await listedEvent(api, id)).availableSeats, 1, 'confirmado ocupa vaga');
});

test('X10 (R05, R07): vitrine e API dividem a mesma lotação, e a listagem conta as compras dos dois canais', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await onSaleEvent(app.users.organizerA.id, { name: 'Lotação compartilhada', capacity: '2' });
  const participant = await signupParticipant(app.baseUrl, 'Comprador X10');

  const viaStorefront = await buy(participant, id, CARD.approveSlow);
  assert.equal(viaStorefront.status, 302);
  assert.equal((await listedEvent(api, id)).availableSeats, 1, 'compra da vitrine conta na API');

  const viaApi = await api.purchase(id, validBody({ cardNumber: CARD.approveSlow }));
  assert.equal(viaApi.status, 202);
  assert.equal((await listedEvent(api, id)).availableSeats, 0);

  const page = await participant.get(`/events/${id}`);
  assert.match(salesExtraOf(page.text), /Ingressos esgotados/, 'compra da API esgota a vitrine');
  const soldOut = await api.purchase(id, validBody());
  assert.equal(soldOut.status, 409);
  assert.deepEqual(soldOut.json, { error: 'sold_out' });

  // Evento cancelado sai da listagem (e, por R05, não tem vagas).
  await cancelViaSql(id);
  assert.equal(await listedEvent(api, id), undefined);
});
