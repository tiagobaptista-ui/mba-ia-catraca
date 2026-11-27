import { html } from '../../core/html.js';
import { formatCents } from '../../core/money.js';
import { formatDateTimeBR } from '../../core/time.js';
import { MESSAGES, TICKET_STATUS_LABELS } from './service.js';

// Mensagem exibida na página do evento para cada recusa da compra (R06, R07).
const PURCHASE_ERROR_MESSAGES = Object.freeze({
  sold_out: MESSAGES.soldOut,
  invalid_card: MESSAGES.invalidCard,
});

export function ticketStatusLabel(status) {
  return TICKET_STATUS_LABELS[status] || status;
}

function seatsText(available) {
  return available === 1 ? '1 vaga disponível' : `${available} vagas disponíveis`;
}

function soldOutBanner() {
  return html`<p class="sold-out" data-available="0"><strong>${MESSAGES.soldOut}</strong></p>`;
}

// Card da vitrine: vagas disponíveis ou "Ingressos esgotados" (R05, R07).
export function storefrontCardExtra({ available }) {
  if (available <= 0) return soldOutBanner();
  return html`<p class="seats" data-available="${available}">${seatsText(available)}</p>`;
}

function purchaseForm(event) {
  return html`<form method="post" action="/events/${event.id}/purchase" class="purchase-form">
    <label for="cardNumber">Número do cartão (16 dígitos)</label>
    <input id="cardNumber" name="cardNumber" inputmode="numeric" autocomplete="cc-number" required>
    <p><button type="submit">Comprar ingresso</button></p>
  </form>`;
}

function callToAction(event, user) {
  if (!user) {
    return html`<p><a href="/login?next=/events/${event.id}">Entre como participante para comprar</a></p>`;
  }
  if (user.role !== 'participant') return html`<p class="muted">Organizadores não compram ingressos.</p>`;
  return purchaseForm(event);
}

// Página pública do evento: resultado da última tentativa (result = { error }), vagas e a compra conforme quem vê.
// Sem vaga, "Ingressos esgotados" fica no lugar do formulário para todos (R07).
export function eventPageExtra({ event, user, available, result }) {
  const message = result && result.error ? PURCHASE_ERROR_MESSAGES[result.error] || null : null;
  if (available <= 0) {
    const alert = message && message !== MESSAGES.soldOut ? html`<p class="error" role="alert">${message}</p>` : '';
    return html`<h2>Ingressos</h2>${alert}${soldOutBanner()}`;
  }
  return html`<h2>Ingressos</h2>
    ${message ? html`<p class="error" role="alert">${message}</p>` : ''}
    <p class="seats" data-available="${available}">${seatsText(available)}</p>
    ${callToAction(event, user)}`;
}

// "Meus ingressos" (R09): evento, data, status (rótulo), código e valor pago.
export function myTicketsBody(tickets, { notice = null } = {}) {
  const noticeBox = notice ? html`<p class="notice" role="status">${notice}</p>` : '';
  if (tickets.length === 0) {
    return html`<h1>Meus ingressos</h1>
      ${noticeBox}
      <p class="muted">Você ainda não comprou ingressos. <a href="/">Ver eventos à venda</a></p>`;
  }
  return html`<h1>Meus ingressos</h1>
    ${noticeBox}
    <p class="muted">Ingresso pendente aguarda a resposta do pagamento: recarregue a página para ver o status atualizado.</p>
    <table class="tickets">
      <thead><tr><th>Evento</th><th>Data</th><th>Status</th><th>Código</th><th>Valor pago</th></tr></thead>
      <tbody>
        ${tickets.map(
          (t) => html`<tr data-ticket-id="${t.id}" data-event-id="${t.eventId}">
            <td>${t.eventStatus === 'published' ? html`<a href="/events/${t.eventId}">${t.eventName}</a>` : t.eventName}</td>
            <td>${formatDateTimeBR(t.eventStartsAt)}</td>
            <td data-status="${t.status}">${ticketStatusLabel(t.status)}</td>
            <td><code class="ticket-code">${t.code}</code></td>
            <td>${formatCents(t.priceCents)}</td>
          </tr>`,
        )}
      </tbody>
    </table>`;
}
