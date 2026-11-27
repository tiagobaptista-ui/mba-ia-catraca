import { withTransaction } from '../../core/db.js';
import { normalizeTicketCode } from '../sales/service.js';

// Check-in (F06, R10). O organizador informa o código de um ingresso na página de gestão do evento; a primeira
// situação verdadeira da lista, na ordem, decide a mensagem. Ter passado pelo check-in não é status: é
// tickets.checked_in_at (coluna de F04).

// Textos exatos da interface (o avaliador compara), na ordem de R10.
export const CHECKIN_MESSAGES = Object.freeze({
  invalid: 'Ingresso inválido para este evento', // 1. código inexistente ou de outro evento
  event_cancelled: 'Evento cancelado', // 2. evento cancelado
  not_confirmed: 'Ingresso não confirmado', // 3. pendente, recusado, cancelado ou estornado
  already_used: 'Ingresso já utilizado', // 4. checked_in_at preenchido
  released: 'Entrada liberada', // 5. nenhuma das anteriores: grava checked_in_at
});

export const CHECKIN_KEYS = Object.freeze(Object.keys(CHECKIN_MESSAGES));

const outcome = (key) => ({ key, message: CHECKIN_MESSAGES[key] });

// Situações 2 a 4 sobre o evento e o ingresso já travados; null = nenhuma (situação 5).
function blockingSituation(event, ticket) {
  if (event.status === 'cancelled') return 'event_cancelled';
  if (ticket.status !== 'confirmed') return 'not_confirmed';
  if (ticket.checked_in_at !== null) return 'already_used';
  return null;
}

// Valida a entrada do ingresso `rawCode` no evento `eventId`. → { key, message } (key em CHECKIN_KEYS).
//
// Uma transação, na mesma ordem de locks da compra (F04) e do cancelamento (F07) — evento → ingresso —, para não
// haver deadlock com eles:
//   1. evento FOR SHARE: espera um cancelamento (ou compra) em andamento terminar e vê o status já commitado;
//      check-ins do mesmo evento não se bloqueiam entre si nesse lock;
//   2. ingresso FOR UPDATE, só se for deste evento: serializa check-ins do mesmo código — o segundo relê a linha
//      com checked_in_at preenchido e cai em "Ingresso já utilizado" (exatamente um "Entrada liberada").
// O código segue a normalização de F04 (trim + maiúsculas); vazio → inválido.
export async function checkIn(eventId, rawCode) {
  const code = normalizeTicketCode(rawCode);
  if (code === '' || typeof eventId !== 'string' || eventId === '') return outcome('invalid');

  return withTransaction(async (client) => {
    const { rows: events } = await client.query('SELECT id, status FROM events WHERE id = $1 FOR SHARE', [eventId]);
    if (events.length === 0) return outcome('invalid');

    const { rows: tickets } = await client.query(
      'SELECT id, status, checked_in_at FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE',
      [code, eventId],
    );
    if (tickets.length === 0) return outcome('invalid'); // 1. inexistente ou de outro evento

    const situation = blockingSituation(events[0], tickets[0]);
    if (situation) return outcome(situation);

    await client.query('UPDATE tickets SET checked_in_at = now(), updated_at = now() WHERE id = $1', [tickets[0].id]);
    return outcome('released');
  });
}
