// Apoio dos testes de F06 (não é arquivo de teste: não casa com *.test.js).
import { query, withTransaction } from '../../src/core/db.js';
import { createEvent, lockEvent, publishEvent } from '../../src/modules/events/service.js';
import { purchaseTicket } from '../../src/modules/sales/service.js';
import { CARD, eventInput } from '../F04/support.js';

export { CARD, buy, createEventVia, deliverResponses, eventInput, loginAs, signupParticipant } from '../F04/support.js';

// Mensagens exatas de R10 (brief), escritas aqui de novo de propósito: o teste não confia na constante do serviço.
export const R10 = Object.freeze({
  invalid: 'Ingresso inválido para este evento',
  event_cancelled: 'Evento cancelado',
  not_confirmed: 'Ingresso não confirmado',
  already_used: 'Ingresso já utilizado',
  released: 'Entrada liberada',
});

export const expected = (key) => ({ key, message: R10[key] });

// Evento publicado do organizador, criado pelo serviço de F02.
export async function onSaleEvent(organizerId, overrides = {}) {
  const { event, errors } = await createEvent(organizerId, eventInput({ capacity: '20', ...overrides }));
  if (!event) throw new Error(`criação de evento falhou: ${errors}`);
  await publishEvent(organizerId, event.id);
  return event.id;
}

let buyers = 0;

// Compra pelo serviço de vendas de F04: canal 'partner' (sem conta) ou 'storefront' (com userId).
export async function sell(eventId, { card = CARD.approve, channel = 'partner', userId = null } = {}) {
  buyers += 1;
  const result = await purchaseTicket({
    eventId,
    cardNumber: card,
    buyerEmail: `f06.${buyers}@teste.dev`,
    userId: channel === 'storefront' ? userId : null,
    channel,
  });
  if (!result.ok) throw new Error(`compra falhou: ${result.error}`);
  return result.ticket;
}

// Segura a resposta do gateway (1 h no futuro) para o ingresso ficar pendente de forma determinística, mesmo com
// GATEWAY_TIME_SCALE=0.02 (0003/0004 responderiam em ~0,6–0,8 s). deliverResponses() antecipa de novo.
export async function holdGatewayResponse(ticketIds) {
  await query("UPDATE gateway_charges SET respond_at = now() + interval '1 hour' WHERE ticket_id = ANY($1::text[])", [
    ticketIds,
  ]);
}

export async function ticketRow(id) {
  const { rows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function setTicketStatus(id, status) {
  await query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
}

// Cancelamento como F07 fará (ainda não existe nesta branch): evento cancelado e, na mesma transação, com a mesma
// ordem de locks (evento FOR UPDATE → ingressos), confirmados → estornados e pendentes → cancelados.
export async function cancelLikeF07(eventId) {
  await withTransaction(async (client) => {
    await lockEvent(client, eventId);
    await client.query("UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1", [
      eventId,
    ]);
    await client.query(
      `UPDATE tickets
          SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' ELSE status END,
              updated_at = now()
        WHERE event_id = $1`,
      [eventId],
    );
  });
}

// Resultado do check-in na página: <p class="checkin-result" data-result="<key>">mensagem</p>.
const RESULT_RE = /<p class="checkin-result" data-result="([a-z_]*)">([^<]*)<\/p>/g;

export function checkinResultsOf(text) {
  return [...text.matchAll(RESULT_RE)].map(([, key, message]) => ({ key, message }));
}

// POST do check-in pela página de gestão. → { status, text, result } (result = o único resultado na página ou null).
export async function checkinVia(client, eventId, code) {
  const res = await client.post(`/organizer/events/${eventId}/checkin`, code === undefined ? {} : { code });
  const results = checkinResultsOf(res.text);
  if (results.length > 1) throw new Error(`mais de um resultado de check-in na página: ${JSON.stringify(results)}`);
  return { ...res, result: results[0] || null };
}

// Mesmo recorte do contrato (C02…C10): grep -o 'data-result="[a-z_]*">[^<]*'.
export function contractGrep(text) {
  return [...text.matchAll(/data-result="[a-z_]*">[^<]*/g)].map((m) => m[0]);
}

export { mainOf, sectionKeys, sectionOf, mainText } from '../F02/support.js';
