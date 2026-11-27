// Apoio dos testes de F07 (não é arquivo de teste: não casa com *.test.js).
import { query } from '../../src/core/db.js';
import { createEvent, publishEvent } from '../../src/modules/events/service.js';
import { purchaseTicket } from '../../src/modules/sales/service.js';
import { eventInput } from '../F04/support.js';

export {
  CARD,
  buy,
  countRows,
  createEventVia,
  deliverResponses,
  eventInput,
  loginAs,
  mainOf,
  myTicketRows,
  signupParticipant,
  ticketRow,
  ticketsOf,
} from '../F04/support.js';
export { eventRow, sectionKeys, sectionOf } from '../F02/support.js';

// Evento do organizador criado pelo serviço de F02; publicado por padrão.
export async function serviceEvent(organizerId, overrides = {}, { publish = true } = {}) {
  const { event, errors } = await createEvent(organizerId, eventInput({ name: 'Show F07', capacity: '10', ...overrides }));
  if (!event) throw new Error(`criação de evento falhou: ${errors.join(' ')}`);
  if (publish) await publishEvent(organizerId, event.id);
  return event.id;
}

// Compras pelo serviço único de F04, nos dois canais (vitrine: participante; parceiro: só e-mail).
export function buyStorefront(eventId, cardNumber, user) {
  return purchaseTicket({ eventId, cardNumber, buyerEmail: user.email, userId: user.id, channel: 'storefront' });
}

let partnerBuyers = 0;

export function buyPartner(eventId, cardNumber) {
  partnerBuyers += 1;
  return purchaseTicket({ eventId, cardNumber, buyerEmail: `parceiro${partnerBuyers}@teste.dev`, channel: 'partner' });
}

// Empurra a resposta do gateway destes ingressos para daqui a 1 h: com workers: false, nenhuma entrega
// (processDueCharges/deliverResponses) os alcança até o teste decidir.
export async function holdResponses(ticketIds) {
  await query("UPDATE gateway_charges SET respond_at = now() + interval '1 hour' WHERE ticket_id = ANY($1::text[])", [
    ticketIds,
  ]);
}

// { ticketId: status } dos ingressos do evento.
export async function statusesOf(eventId) {
  const { rows } = await query('SELECT id, status FROM tickets WHERE event_id = $1', [eventId]);
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

export async function chargeOf(ticketId) {
  const { rows } = await query('SELECT * FROM gateway_charges WHERE ticket_id = $1', [ticketId]);
  return rows[0] || null;
}

// Ingressos do evento que ainda ocupam vaga (não podem sobrar depois do cancelamento).
export async function activeTicketsOf(eventId) {
  const { rows } = await query(
    "SELECT id, status FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')",
    [eventId],
  );
  return rows;
}

export const HAS_CANCEL_BUTTON = />Cancelar evento<\/button>/;
