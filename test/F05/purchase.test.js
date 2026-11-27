// Compra e consulta pela API de parceiros (F05-CA02, F05-CA03, F05-CA04, X10, X11), com o worker do gateway ligado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { useTestApp, SEED } from '../helpers/index.js';
import { config } from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import { TICKET_CODE_ALPHABET } from '../../src/core/ids.js';
import {
  CARD,
  KEY,
  assertError,
  buy,
  cancelViaSql,
  countRows,
  createEventVia,
  listedEvent,
  loginAs,
  onSaleEvent,
  partnerApi,
  rawRequest,
  signupParticipant,
  ticketRow,
  ticketsOf,
  validBody,
  waitForTicketStatus,
} from './support.js';

const app = useTestApp({ workers: true });

const CODE_RE = new RegExp(`^[${TICKET_CODE_ALPHABET}]{8}$`);

const newEvent = (overrides) => onSaleEvent(app.users.organizerA.id, overrides);

test('C06, F05-CA02 (R06): compra válida → 202 { ticketId, code, status: "pending" } sem esperar o gateway', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Compra C06', capacity: '2', price: '100,00' });

  assert.equal((await api.purchase(id, '{')).status, 422); // aquece conexões e o parser antes de medir

  // Escala real do gateway (1): a aprovação do 0001 está a ≥ 2 s; a resposta da API vem bem antes.
  const saved = config.gatewayTimeScale;
  config.gatewayTimeScale = 1;
  let res;
  let elapsed;
  try {
    const started = performance.now();
    res = await api.purchase(id, { buyerEmail: 'ana@example.com', cardNumber: '4000000000000001' });
    elapsed = performance.now() - started;
  } finally {
    config.gatewayTimeScale = saved;
  }

  assert.equal(res.status, 202, res.text);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(Object.keys(res.json), ['ticketId', 'code', 'status']);
  assert.match(res.json.ticketId, /^tkt_/);
  assert.match(res.json.code, CODE_RE);
  assert.equal(res.json.status, 'pending');
  assert.ok(elapsed < 1500, `respondeu em ${Math.round(elapsed)} ms, sem esperar o gateway`);

  // Compra da API: canal partner, sem conta de participante, e-mail do comprador informado, preço vigente (R03).
  const row = await ticketRow(res.json.ticketId);
  assert.equal(row.event_id, id);
  assert.equal(row.code, res.json.code);
  assert.equal(row.status, 'pending');
  assert.equal(row.channel, 'partner');
  assert.equal(row.user_id, null);
  assert.equal(row.buyer_email, 'ana@example.com');
  assert.equal(row.price_cents, 10000);
  const { rows: charges } = await query('SELECT * FROM gateway_charges WHERE ticket_id = $1', [row.id]);
  assert.equal(charges.length, 1, 'uma cobrança pedida no ato da compra');
  assert.equal(charges[0].responded_at, null, 'gateway ainda não respondeu');
  assert.ok(charges[0].respond_at.getTime() - Date.now() > 1000, 'resposta do gateway marcada para segundos depois');
});

test('C08, C09, F05-CA04 (R08): consulta mostra pendente e, com a aprovação do gateway, confirmado', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Consulta C08', capacity: '3' });

  // 0003: aprovação lenta (~0,6–0,8 s nos testes) — dá para ver o pendente.
  const slow = await api.purchase(id, validBody({ cardNumber: CARD.approveSlow }));
  assert.equal(slow.status, 202);
  const pending = await api.ticket(slow.json.ticketId);
  assert.equal(pending.status, 200);
  assert.match(pending.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(Object.keys(pending.json), ['ticketId', 'code', 'eventId', 'status', 'checkedIn']);
  assert.deepEqual(pending.json, {
    ticketId: slow.json.ticketId,
    code: slow.json.code,
    eventId: id,
    status: 'pending',
    checkedIn: false,
  });
  assert.deepEqual(await waitForTicketStatus(api, slow.json.ticketId, 'confirmed'), { ...pending.json, status: 'confirmed' });

  // 0001 confirma; 0002 recusa.
  const fast = await api.purchase(id, validBody({ cardNumber: CARD.approve }));
  const confirmed = await waitForTicketStatus(api, fast.json.ticketId, 'confirmed');
  assert.deepEqual(confirmed, { ticketId: fast.json.ticketId, code: fast.json.code, eventId: id, status: 'confirmed', checkedIn: false });
  assert.equal((await listedEvent(api, id)).availableSeats, 1);

  const declined = await api.purchase(id, validBody({ cardNumber: CARD.decline }));
  assert.equal((await waitForTicketStatus(api, declined.json.ticketId, 'declined')).checkedIn, false);
  assert.equal((await listedEvent(api, id)).availableSeats, 1, 'recusado não ocupa vaga');
});

test('F05-CA04: checkedIn reflete o check-in (checked_in_at, gravado por F06) sem mudar o status', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Check-in na API' });
  const res = await api.purchase(id, validBody());
  await waitForTicketStatus(api, res.json.ticketId, 'confirmed');
  await query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [res.json.ticketId]);
  const after = await api.ticket(res.json.ticketId);
  assert.equal(after.json.checkedIn, true);
  assert.equal(after.json.status, 'confirmed');
});

test('C10, F05-CA03 (R07): sem vaga → 409 {"error":"sold_out"} e nenhum ingresso a mais', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Esgota C10', capacity: '1' });
  const first = await api.purchase(id, validBody());
  assert.equal(first.status, 202);
  await waitForTicketStatus(api, first.json.ticketId, 'confirmed');

  assertError(await api.purchase(id, validBody({ buyerEmail: 'outro@example.com' })), 409, 'sold_out');
  assertError(await api.purchase(id, validBody({ cardNumber: CARD.decline })), 409, 'sold_out', 'cartão não importa');
  assert.equal((await ticketsOf(id)).length, 1);
  assert.equal((await listedEvent(api, id)).availableSeats, 0);
});

// Corpos inválidos (F05-CA03): campo faltando, e-mail mal formado, cartão sem 16 dígitos ou não-string, JSON
// malformado ou não-objeto.
const INVALID_BODIES = [
  ['cartão "123"', validBody({ cardNumber: '123' })],
  ['sem buyerEmail', { cardNumber: CARD.approve }],
  ['sem cardNumber', { buyerEmail: 'ana@example.com' }],
  ['objeto vazio', {}],
  ['buyerEmail "x"', validBody({ buyerEmail: 'x' })],
  ['buyerEmail sem domínio', validBody({ buyerEmail: 'ana@' })],
  ['buyerEmail sem ponto no domínio', validBody({ buyerEmail: 'ana@example' })],
  ['buyerEmail com espaço', validBody({ buyerEmail: 'ana maria@example.com' })],
  ['buyerEmail com espaço nas pontas', validBody({ buyerEmail: ' ana@example.com ' })],
  ['buyerEmail vazio', validBody({ buyerEmail: '' })],
  ['buyerEmail número', validBody({ buyerEmail: 123 })],
  ['buyerEmail null', validBody({ buyerEmail: null })],
  ['buyerEmail longo demais', validBody({ buyerEmail: `${'a'.repeat(250)}@example.com` })],
  ['cartão número', validBody({ cardNumber: 4000000000000001 })],
  ['cartão com 15 dígitos', validBody({ cardNumber: '400000000000001' })],
  ['cartão com 17 dígitos', validBody({ cardNumber: '40000000000000011' })],
  ['cartão com espaços', validBody({ cardNumber: '4000 0000 0000 0001' })],
  ['cartão com espaço no fim', validBody({ cardNumber: '4000000000000001 ' })],
  ['cartão com letra', validBody({ cardNumber: '400000000000000a' })],
  ['cartão vazio', validBody({ cardNumber: '' })],
  ['cartão null', validBody({ cardNumber: null })],
  ['JSON malformado "{"', '{'],
  ['JSON truncado', '{"buyerEmail":"ana@example.com","cardNumber":"4000000000000001"'],
  ['corpo vazio', ''],
  ['null', 'null'],
  ['array', JSON.stringify([validBody()])],
  ['string JSON', '"ana@example.com"'],
  ['número JSON', '4000000000000001'],
];

test('C12, F05-CA03: corpo inválido → 422 {"error":"invalid_request"} sem criar ingresso nem cobrança', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Corpo inválido C12', capacity: '5' });
  for (const [label, body] of INVALID_BODIES) {
    assertError(await api.purchase(id, body), 422, 'invalid_request', label);
  }

  // O corpo precisa ser JSON: formulário, texto ou nenhum corpo, mesmo com os campos certos, é 422.
  const path = `/api/partner/events/${id}/purchases`;
  const valid = JSON.stringify(validBody());
  const nonJson = [
    ['formulário', { 'content-type': 'application/x-www-form-urlencoded' }, 'buyerEmail=ana%40example.com&cardNumber=4000000000000001'],
    ['text/plain', { 'content-type': 'text/plain' }, valid],
    ['sem Content-Type', {}, undefined],
  ];
  for (const [label, headers, body] of nonJson) {
    const res = await rawRequest(app.baseUrl, 'POST', path, { headers: { ...headers, 'x-api-key': KEY }, body });
    assertError(res, 422, 'invalid_request', label);
  }

  assert.equal((await ticketsOf(id)).length, 0, 'nenhum ingresso');
  assert.equal((await listedEvent(api, id)).availableSeats, 5);

  // O mesmo evento aceita a compra quando o corpo é válido (campos extras são ignorados).
  const ok = await api.purchase(id, { ...validBody(), extra: 'ignorado', quantity: 3 });
  assert.equal(ok.status, 202, ok.text);
  assert.equal((await ticketsOf(id)).length, 1);
  const charset = await rawRequest(app.baseUrl, 'POST', path, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-api-key': KEY },
    body: valid,
  });
  assert.equal(charset.status, 202, 'application/json com charset utf-8 é JSON');
});

test('C13, F05-CA03: a ordem é 422 → 404 → 409 (corpo inválido ganha de evento inexistente e de esgotado)', async () => {
  const api = partnerApi(app.baseUrl);
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const draft = await createEventVia(a, { name: 'Rascunho C13' }, { publish: false });
  const cancelled = await newEvent({ name: 'Cancelado C13' });
  await cancelViaSql(cancelled);
  const soldOut = await newEvent({ name: 'Esgotado C13', capacity: '1' });
  assert.equal((await api.purchase(soldOut, validBody())).status, 202);

  for (const eventId of ['evt_inexistente', draft, cancelled, soldOut]) {
    assertError(await api.purchase(eventId, validBody({ cardNumber: '123' })), 422, 'invalid_request', `${eventId} cartão 123`);
    assertError(await api.purchase(eventId, '{'), 422, 'invalid_request', `${eventId} JSON malformado`);
    assertError(await api.purchase(eventId, { cardNumber: CARD.approve }), 422, 'invalid_request', `${eventId} sem e-mail`);
  }
  // 404 ganha de 409: cancelado com lotação cheia é evento fora de venda.
  const fullThenCancelled = await newEvent({ name: 'Cheio e cancelado', capacity: '1' });
  assert.equal((await api.purchase(fullThenCancelled, validBody())).status, 202);
  await cancelViaSql(fullThenCancelled);
  assertError(await api.purchase(fullThenCancelled, validBody()), 404, 'event_not_available', 'cancelado e cheio');
  assertError(await api.purchase(soldOut, validBody()), 409, 'sold_out', 'publicado e cheio');
});

test('C14, F05-CA03 (R02): evento inexistente, rascunho ou cancelado → 404 {"error":"event_not_available"}', async () => {
  const api = partnerApi(app.baseUrl);
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const draft = await createEventVia(a, { name: 'Rascunho C14' }, { publish: false });
  const cancelled = await createEventVia(a, { name: 'Cancelado C14' });
  await cancelViaSql(cancelled);
  const countBefore = await countRows('tickets');

  for (const eventId of ['evt_inexistente', draft, cancelled, 'x', `evt_${'z'.repeat(300)}`, "evt' OR '1'='1"]) {
    assertError(await api.purchase(eventId, validBody()), 404, 'event_not_available', eventId);
  }
  assert.equal(await countRows('tickets'), countBefore, 'nenhum ingresso criado');
  assert.equal(await listedEvent(api, draft), undefined, 'rascunho fora da listagem');
  assert.equal(await listedEvent(api, cancelled), undefined, 'cancelado fora da listagem');
});

test('C15, F05-CA04: ingresso inexistente → 404 {"error":"ticket_not_found"}', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Consulta C15' });
  const bought = await api.purchase(id, validBody());
  // O código do ingresso e o id do evento não são ids de ingresso.
  for (const ticketId of ['tkt_inexistente', 'x', bought.json.code, id, `${bought.json.ticketId}x`]) {
    assertError(await api.ticket(ticketId), 404, 'ticket_not_found', ticketId);
  }
});

test('C16, X11 (R06, R08): ingresso comprado na vitrine é consultável na API e a confirmação aparece como confirmed', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Vitrine X11', capacity: '2' });
  const participant = await signupParticipant(app.baseUrl, 'Participante X11');
  const res = await buy(participant, id, CARD.approveSlow);
  assert.equal(res.status, 302);
  const { rows } = await query(
    "SELECT id, code FROM tickets WHERE channel = 'storefront' ORDER BY created_at DESC LIMIT 1",
  );
  const [storefront] = rows;

  const pending = await api.ticket(storefront.id);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.json, { ticketId: storefront.id, code: storefront.code, eventId: id, status: 'pending', checkedIn: false });
  assert.deepEqual(await waitForTicketStatus(api, storefront.id, 'confirmed'), { ...pending.json, status: 'confirmed' });

  // Recusa da vitrine também aparece.
  const declinedBuy = await buy(participant, id, CARD.decline);
  assert.equal(declinedBuy.status, 302);
  const { rows: latest } = await query(
    "SELECT id FROM tickets WHERE channel = 'storefront' AND event_id = $1 ORDER BY created_at DESC LIMIT 1",
    [id],
  );
  assert.equal((await waitForTicketStatus(api, latest[0].id, 'declined')).eventId, id);
});

test('X11 (R11): estornado e cancelado (status de F07) aparecem como estão no banco', async () => {
  const api = partnerApi(app.baseUrl);
  const id = await newEvent({ name: 'Status F07', capacity: '3' });
  const confirmed = await api.purchase(id, validBody());
  const pending = await api.purchase(id, validBody({ cardNumber: CARD.approveSlow }));
  await waitForTicketStatus(api, confirmed.json.ticketId, 'confirmed');
  await cancelViaSql(id);
  await query("UPDATE tickets SET status = 'refunded', updated_at = now() WHERE id = $1", [confirmed.json.ticketId]);
  await query("UPDATE tickets SET status = 'cancelled', updated_at = now() WHERE id = $1", [pending.json.ticketId]);
  assert.equal((await api.ticket(confirmed.json.ticketId)).json.status, 'refunded');
  assert.equal((await api.ticket(pending.json.ticketId)).json.status, 'cancelled');
});
