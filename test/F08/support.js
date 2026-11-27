// Apoio dos testes de F08 (não é arquivo de teste: não casa com *.test.js).
import { query } from '../../src/core/db.js';

export { CARD, buy, createEventVia, deliverResponses, eventInput, loginAs, signupParticipant } from '../F04/support.js';

// Rótulos exatos de R12, na ordem do painel, com a chave de data-metric de cada número.
export const METRIC_LABELS = Object.freeze({
  confirmed: 'Confirmados',
  pending: 'Pendentes',
  checkins: 'Check-ins',
  available: 'Vagas disponíveis',
  revenue: 'Receita',
  refunded: 'Estornados',
});

// Keys das seções da página de gestão, na ordem em que aparecem.
export function sectionKeys(text) {
  return [...text.matchAll(/<section data-section="([^"]+)"/g)].map((m) => m[1]);
}

// HTML da seção do painel; null se não aparece.
export function dashboardSectionOf(text) {
  const match = /<section data-section="dashboard">([\s\S]*?)<\/section>/.exec(text);
  return match ? match[1] : null;
}

// Números do painel como o contrato os lê (grep 'data-metric="[a-z]*">[^<]*'): { confirmed: '3', revenue: 'R$ 350,00', … }.
export function metricsOf(text) {
  return Object.fromEntries([...text.matchAll(/data-metric="([a-z]+)">([^<]*)/g)].map(([, key, value]) => [key, value]));
}

// Painel esperado, no formato de metricsOf (contagens como texto, receita formatada).
export function panel({ confirmed = 0, pending = 0, checkins = 0, available, revenue = 'R$ 0,00', refunded = 0 }) {
  return {
    confirmed: String(confirmed),
    pending: String(pending),
    checkins: String(checkins),
    available: String(available),
    revenue,
    refunded: String(refunded),
  };
}

// Lê o painel na página de gestão (cliente do organizador dono).
export async function readPanel(organizer, eventId) {
  const res = await organizer.get(`/organizer/events/${eventId}`);
  if (res.status !== 200) throw new Error(`página de gestão respondeu ${res.status}`);
  return metricsOf(res.text);
}

// Segura a resposta do gateway destes ingressos (respond_at daqui a 1 hora): com o worker ligado ou com
// deliverResponses, o ingresso fica pendente até releaseResponses — o "~40 s" do cartão lento, sob controle do teste.
export async function holdResponses(ticketIds) {
  await query("UPDATE gateway_charges SET respond_at = now() + interval '1 hour' WHERE ticket_id = ANY($1::text[])", [
    ticketIds,
  ]);
}

// Libera as respostas seguradas (vencem agora; o worker as entrega na próxima varredura).
export async function releaseResponses(ticketIds) {
  await query('UPDATE gateway_charges SET respond_at = now() WHERE ticket_id = ANY($1::text[])', [ticketIds]);
}

export async function ticketStatus(ticketId) {
  const { rows } = await query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
  return rows[0] ? rows[0].status : null;
}

// Ids dos ingressos do evento, do mais antigo ao mais novo.
export async function ticketIdsOf(eventId) {
  const { rows } = await query('SELECT id FROM tickets WHERE event_id = $1 ORDER BY created_at, id', [eventId]);
  return rows.map((r) => r.id);
}

// Efeitos de F06 e F07 simulados por SQL (essas features não existem nesta branch).
export async function checkIn(ticketId) {
  await query('UPDATE tickets SET checked_in_at = now(), updated_at = now() WHERE id = $1', [ticketId]);
}

export async function setTicketStatus(ticketId, status) {
  await query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [ticketId, status]);
}

// Cancelamento do evento como F07 fará (R11): evento cancelado, confirmados → estornados, pendentes → cancelados.
export async function cancelEvent(eventId) {
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1", [
    eventId,
  ]);
  await query(
    `UPDATE tickets
        SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' ELSE status END,
            updated_at = now()
      WHERE event_id = $1`,
    [eventId],
  );
}
