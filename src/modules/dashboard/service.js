import { query } from '../../core/db.js';
import { OCCUPYING_STATUSES, availableSeats } from '../sales/service.js';

// Painel do evento (F08, R12). Conta os ingressos do evento sem filtrar o canal: vitrine e API de parceiros valem
// igual (F08-CA05). Definições:
//   - Confirmados: `confirmed`, com ou sem check-in (check-in não é status);
//   - Pendentes: `pending`;
//   - Check-ins: `confirmed` com checked_in_at (estornado que tinha passado pelo check-in não conta);
//   - Vagas disponíveis: R05 pela definição única de F04 (availableSeats + OCCUPYING_STATUSES; 0 em cancelado);
//   - Receita: soma do price_cents GRAVADO em cada ingresso `confirmed` — o preço vigente na compra (R03), nunca o
//     preço atual do evento; estornado não é receita;
//   - Estornados: `refunded`.
// Uma query só (um snapshot): os números e a lotação/status do evento vêm do mesmo instante.
const DASHBOARD_SQL = `
  SELECT e.capacity, e.status,
         count(t.id) FILTER (WHERE t.status = 'confirmed')                                AS confirmed,
         count(t.id) FILTER (WHERE t.status = 'pending')                                  AS pending,
         count(t.id) FILTER (WHERE t.status = 'confirmed' AND t.checked_in_at IS NOT NULL) AS checkins,
         count(t.id) FILTER (WHERE t.status = 'refunded')                                 AS refunded,
         count(t.id) FILTER (WHERE t.status = ANY($2::text[]))                            AS occupied,
         COALESCE(sum(t.price_cents) FILTER (WHERE t.status = 'confirmed'), 0)            AS revenue_cents
    FROM events e
    LEFT JOIN tickets t ON t.event_id = e.id
   WHERE e.id = $1
   GROUP BY e.id`;

// getDashboard(event | eventId) → { confirmed, pending, checkins, available, revenueCents, refunded }
// ou null (evento inexistente). Calculado a cada chamada (sem cache: recarregar a página basta).
export async function getDashboard(eventOrId) {
  const eventId = typeof eventOrId === 'string' ? eventOrId : eventOrId && eventOrId.id;
  if (typeof eventId !== 'string' || eventId === '') return null;
  const { rows } = await query(DASHBOARD_SQL, [eventId, OCCUPYING_STATUSES]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    confirmed: row.confirmed,
    pending: row.pending,
    checkins: row.checkins,
    available: availableSeats({ capacity: row.capacity, status: row.status }, row.occupied),
    revenueCents: row.revenue_cents,
    refunded: row.refunded,
  };
}
