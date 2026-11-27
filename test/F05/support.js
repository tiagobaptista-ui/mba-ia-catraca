// Apoio dos testes de F05 (não é arquivo de teste: não casa com *.test.js).
import assert from 'node:assert/strict';
import { createClient, PARTNER_KEY, waitFor } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { createEvent, publishEvent } from '../../src/modules/events/service.js';
import { eventInput } from '../F04/support.js';

export {
  CARD,
  buy,
  countRows,
  createEventVia,
  eventInput,
  loginAs,
  salesExtraOf,
  signupParticipant,
  ticketRow,
  ticketsOf,
} from '../F04/support.js';

export const KEY = PARTNER_KEY;

// Cliente da API de parceiros. key = null não envia o cabeçalho X-Api-Key.
// purchase(eventId, body): body objeto vira JSON; string é enviada como está (JSON malformado), sempre com
// Content-Type: application/json.
export function partnerApi(baseUrl, key = KEY) {
  const client = createClient(baseUrl);
  const headers = key === null ? {} : { 'x-api-key': key };
  return {
    listEvents: () => client.get('/api/partner/events', { headers }),
    purchase: (eventId, body) =>
      client.request('POST', `/api/partner/events/${encodeURIComponent(eventId)}/purchases`, { json: body, headers }),
    ticket: (ticketId) => client.get(`/api/partner/tickets/${encodeURIComponent(ticketId)}`, { headers }),
  };
}

// Requisição crua (cabeçalhos e corpo livres) para os casos que o cliente acima não cobre.
export async function rawRequest(baseUrl, method, path, { headers = {}, body } = {}) {
  const res = await fetch(baseUrl + path, { method, headers, body, redirect: 'manual' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

export const validBody = (overrides = {}) => ({
  buyerEmail: 'ana@example.com',
  cardNumber: '4000000000000001',
  ...overrides,
});

// Resposta de erro JSON exata do contrato.
export function assertError(res, status, error, label = '') {
  assert.equal(res.status, status, `${label} status (${res.text})`);
  assert.match(res.headers.get('content-type') || '', /^application\/json/, `${label} content-type`);
  assert.deepEqual(res.json, { error }, `${label} corpo`);
}

// Evento do organizador A criado e publicado pelo serviço de F02 (publish = false deixa como rascunho).
export async function onSaleEvent(organizerId, overrides = {}, { publish = true } = {}) {
  const { event, errors } = await createEvent(organizerId, eventInput(overrides));
  if (!event) throw new Error(`criação de evento falhou: ${errors}`);
  if (publish) await publishEvent(organizerId, event.id);
  return event.id;
}

// Cancelamento direto no banco (F07 ainda não existe nesta branch; é o que o contrato manda fazer).
export async function cancelViaSql(eventId) {
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [eventId]);
}

// Item da listagem com o id dado (ou undefined).
export async function listedEvent(api, eventId) {
  const res = await api.listEvents();
  assert.equal(res.status, 200, res.text);
  return res.json.find((e) => e.id === eventId);
}

// Espera o ingresso chegar ao status na API (o worker do gateway responde em ~40–90 ms para 0001/0002 e
// ~0,6–0,8 s para 0003/0004 com GATEWAY_TIME_SCALE=0.02).
export async function waitForTicketStatus(api, ticketId, status, { timeoutMs = 5000 } = {}) {
  return waitFor(async () => {
    const res = await api.ticket(ticketId);
    assert.equal(res.status, 200, res.text);
    return res.json.status === status ? res.json : null;
  }, { timeoutMs, intervalMs: 20 });
}
