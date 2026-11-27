// Autenticação da API de parceiros (F05-CA05, X08): X-Api-Key é checada antes de qualquer outra validação.
// Sem o worker do gateway: nenhum ingresso muda de status durante os testes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useTestApp } from '../helpers/index.js';
import { config } from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import { purchaseTicket } from '../../src/modules/sales/service.js';
import { KEY, assertError, onSaleEvent, partnerApi, rawRequest, validBody } from './support.js';

const app = useTestApp({ workers: false });

// Evento à venda e ingresso reais (o 401 não pode vir de recurso inexistente), criados uma vez, no primeiro uso
// (os hooks before do arquivo não têm ordem garantida entre si).
let fixturesPromise;
function fixtures() {
  fixturesPromise ??= (async () => {
    const eventId = await onSaleEvent(app.users.organizerA.id, { name: 'Auth F05', capacity: '10' });
    const { ticket } = await purchaseTicket({
      eventId,
      cardNumber: '4000000000000001',
      buyerEmail: 'auth@example.com',
      channel: 'partner',
    });
    return { eventId, ticketId: ticket.id };
  })();
  return fixturesPromise;
}

async function ticketCount() {
  await fixtures();
  const { rows } = await query('SELECT count(*) AS n FROM tickets');
  return rows[0].n;
}

// As três rotas do contrato, com o corpo dado no POST.
async function threeRoutes(api, body = validBody()) {
  const { eventId, ticketId } = await fixtures();
  return [
    ['GET /events', () => api.listEvents()],
    ['POST /events/:id/purchases', () => api.purchase(eventId, body)],
    ['GET /tickets/:id', () => api.ticket(ticketId)],
  ];
}

test('C01, F05-CA05: sem X-Api-Key, as três rotas respondem 401 {"error":"unauthorized"} e nada é criado', async () => {
  const countBefore = await ticketCount();
  for (const body of [validBody(), '{', validBody({ cardNumber: '123' })]) {
    for (const [label, call] of await threeRoutes(partnerApi(app.baseUrl, null), body)) {
      assertError(await call(), 401, 'unauthorized', label);
    }
  }
  assert.equal(await ticketCount(), countBefore, 'nenhum ingresso criado sem chave');
});

test('C02, F05-CA05, X08: chave errada → 401 nas três rotas, inclusive no POST com corpo malformado', async () => {
  const countBefore = await ticketCount();
  const wrongKeys = ['errada', '', 'PK_TEST_CATRACA_PARCEIRO', KEY.slice(0, -1), `${KEY}x`, `x${KEY}`, `${KEY},${KEY}`];
  for (const key of wrongKeys) {
    for (const body of ['{', validBody(), validBody({ buyerEmail: 'x' })]) {
      for (const [label, call] of await threeRoutes(partnerApi(app.baseUrl, key), body)) {
        assertError(await call(), 401, 'unauthorized', `${label} com chave ${JSON.stringify(key)}`);
      }
    }
  }
  // Chave em outro cabeçalho ou na query string não vale.
  const elsewhere = [
    ['/api/partner/events', { authorization: `Bearer ${KEY}` }],
    [`/api/partner/events?apiKey=${KEY}`, {}],
    ['/api/partner/events', { 'x-api-token': KEY }],
  ];
  for (const [path, headers] of elsewhere) {
    assertError(await rawRequest(app.baseUrl, 'GET', path, { headers }), 401, 'unauthorized', path);
  }
  assert.equal(await ticketCount(), countBefore, 'nenhum ingresso criado com chave errada');
});

test('C01, C13: a chave vem antes de 404, 422 e 409 (evento inexistente, corpo inválido, caminho desconhecido)', async () => {
  const noKey = partnerApi(app.baseUrl, null);
  assertError(await noKey.purchase('evt_inexistente', validBody()), 401, 'unauthorized', 'evento inexistente');
  assertError(await noKey.purchase('evt_inexistente', '{'), 401, 'unauthorized', 'inexistente + JSON malformado');
  assertError(await noKey.ticket('tkt_inexistente'), 401, 'unauthorized', 'ingresso inexistente');

  // Qualquer caminho sob /api/partner exige a chave; com chave, caminho desconhecido é o 404 JSON do app.
  for (const path of ['/api/partner', '/api/partner/', '/api/partner/nada', '/api/partner/events/x']) {
    assertError(await rawRequest(app.baseUrl, 'GET', path), 401, 'unauthorized', path);
    assertError(await rawRequest(app.baseUrl, 'GET', path, { headers: { 'x-api-key': KEY } }), 404, 'not_found', path);
  }
  const { ticketId } = await fixtures();
  assertError(await rawRequest(app.baseUrl, 'DELETE', `/api/partner/tickets/${ticketId}`), 401, 'unauthorized');
});

test('F05-CA05: corpo que nem chega a ser lido (charset não suportado, grande demais) → 401 sem chave e 422 com chave', async () => {
  const { eventId } = await fixtures();
  const path = `/api/partner/events/${eventId}/purchases`;
  const bodies = [
    // o parser urlencoded global do app (antes do router) falha aqui: o erro ainda passa pela checagem da chave
    { 'content-type': 'application/x-www-form-urlencoded; charset=koi8-x', body: 'buyerEmail=a%40b.co' },
    { 'content-type': 'application/json; charset=koi8-x', body: JSON.stringify(validBody()) },
    { 'content-type': 'application/json', body: JSON.stringify(validBody({ pad: 'x'.repeat(200_000) })) },
    { 'content-type': 'application/x-www-form-urlencoded', body: `pad=${'x'.repeat(200_000)}` },
  ];
  const countBefore = await ticketCount();
  for (const { 'content-type': type, body } of bodies) {
    const label = `${type} (${body.length} bytes)`;
    assertError(await rawRequest(app.baseUrl, 'POST', path, { headers: { 'content-type': type }, body }), 401,
      'unauthorized', `sem chave: ${label}`);
    assertError(await rawRequest(app.baseUrl, 'POST', path, { headers: { 'content-type': type, 'x-api-key': 'errada' }, body }),
      401, 'unauthorized', `chave errada: ${label}`);
    assertError(await rawRequest(app.baseUrl, 'POST', path, { headers: { 'content-type': type, 'x-api-key': KEY }, body }),
      422, 'invalid_request', `com chave: ${label}`);
  }
  assert.equal(await ticketCount(), countBefore);
});

test('C03, X08: a chave configurada pelo harness (PARTNER_API_KEY) é a documentada e é aceita nas três rotas', async () => {
  const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  const harnessKey = /PARTNER_API_KEY:\s*(\S+)/.exec(compose)?.[1];
  assert.equal(harnessKey, 'pk_test_catraca_parceiro', 'docker-compose.yml do produto');
  for (const doc of ['../../README.md', '../../AGENTS.md']) {
    assert.match(await readFile(new URL(doc, import.meta.url), 'utf8'), /pk_test_catraca_parceiro/, doc);
  }
  assert.equal(config.partnerApiKey, harnessKey, 'o ambiente dos gates usa a mesma chave');

  const { eventId, ticketId } = await fixtures();
  const api = partnerApi(app.baseUrl, harnessKey);
  const list = await api.listEvents();
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json.some((e) => e.id === eventId));
  const purchase = await api.purchase(eventId, validBody({ buyerEmail: 'x08@example.com' }));
  assert.equal(purchase.status, 202, purchase.text);
  const ticket = await api.ticket(ticketId);
  assert.equal(ticket.status, 200, ticket.text);
});

test('X08: a chave vem da configuração (PARTNER_API_KEY) a cada requisição; outra chave é recusada', async () => {
  const saved = config.partnerApiKey;
  config.partnerApiKey = 'pk_outra_chave_de_teste';
  try {
    assertError(await partnerApi(app.baseUrl, saved).listEvents(), 401, 'unauthorized', 'chave antiga');
    const res = await partnerApi(app.baseUrl, 'pk_outra_chave_de_teste').listEvents();
    assert.equal(res.status, 200, res.text);
  } finally {
    config.partnerApiKey = saved;
  }
  assert.equal((await partnerApi(app.baseUrl).listEvents()).status, 200);
});
