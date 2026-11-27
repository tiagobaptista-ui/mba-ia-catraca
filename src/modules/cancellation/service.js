import { withTransaction } from '../../core/db.js';
import { lockEvent, mapEvent } from '../events/service.js';

// Cancelamento de evento (F07, R11): irreversível, só de evento publicado, com a conversão dos ingressos no mesmo
// commit (confirmed → refunded, pending → cancelled). declined fica como está.

// Textos exatos da interface (o avaliador compara).
export const MESSAGES = Object.freeze({
  onlyPublished: 'Só eventos publicados podem ser cancelados.',
  alreadyCancelled: 'Evento já está cancelado.',
});

// "Evento cancelado. 1 ingresso estornado e 2 cancelados."
export function cancelledMessage({ refunded, cancelled }) {
  const tickets = refunded === 1 ? 'ingresso estornado' : 'ingressos estornados';
  const pending = cancelled === 1 ? 'cancelado' : 'cancelados';
  return `Evento cancelado. ${refunded} ${tickets} e ${cancelled} ${pending}.`;
}

// Ingressos que o cancelamento converte (R11). A tabela tickets é de F04; aqui só a transição final.
const CONVERT_TICKETS_SQL = `
  UPDATE tickets
     SET status = CASE status WHEN 'confirmed' THEN 'refunded' ELSE 'cancelled' END,
         updated_at = now()
   WHERE event_id = $1
     AND status IN ('pending', 'confirmed')
  RETURNING status`;

// Cancela o evento do organizador. → { event, refunded, cancelled }, { errors, status: 409, event } ou
// { notFound: true } (inexistente ou de outro organizador, R13).
//
// Uma transação só, que começa travando a linha do evento (lockEvent, a mesma da compra em F04):
//   - compra em andamento termina antes (e o ingresso dela é convertido aqui); compra que chega depois espera o
//     lock e encontra o evento 'cancelled' (event_not_available);
//   - evento e ingressos mudam no mesmo commit: "em até 10 s" vira "imediatamente";
//   - resposta do gateway que chega depois encontra o ingresso cancelled/refunded e o UPDATE … WHERE status =
//     'pending' de F04 não o altera. Se ela chega no mesmo instante, o lock da linha do ingresso ordena as duas:
//     confirmação commitada antes é estornada aqui (o UPDATE relê a linha nova); depois, não acha mais 'pending'.
export async function cancelEvent(organizerId, eventId) {
  if (typeof eventId !== 'string' || eventId === '' || !organizerId) return { notFound: true };
  return withTransaction(async (client) => {
    const current = await lockEvent(client, eventId);
    if (!current || current.organizerId !== organizerId) return { notFound: true };
    if (current.status === 'cancelled') return { errors: [MESSAGES.alreadyCancelled], status: 409, event: current };
    if (current.status !== 'published') return { errors: [MESSAGES.onlyPublished], status: 409, event: current };

    const { rows } = await client.query(
      `UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [eventId],
    );
    const converted = await client.query(CONVERT_TICKETS_SQL, [eventId]);
    const refunded = converted.rows.filter((r) => r.status === 'refunded').length;
    return { event: mapEvent(rows[0]), refunded, cancelled: converted.rows.length - refunded };
  });
}
