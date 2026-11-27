import { html } from '../../core/html.js';
import { formatDateTimeBR } from '../../core/time.js';
import { formatCents } from '../../core/money.js';
import { EVENT_STATUS_LABELS } from './service.js';

export function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return html`<ul class="error" role="alert">${errors.map((e) => html`<li>${e}</li>`)}</ul>`;
}

export function noticeBox(notice) {
  return notice ? html`<p class="notice" role="status">${notice}</p>` : '';
}

export function statusLabel(status) {
  return EVENT_STATUS_LABELS[status] || status;
}

// Dados públicos do evento (vitrine e página pública): data dd/mm/aaaa hh:mm, local e preço R$ x,yy.
export function eventFacts(event) {
  return html`<dl class="event-facts">
    <dt>Data e hora</dt><dd>${formatDateTimeBR(event.startsAt)}</dd>
    <dt>Local</dt><dd>${event.venue}</dd>
    <dt>Preço</dt><dd>${formatCents(event.priceCents)}</dd>
  </dl>`;
}

// Corpo da página 404 de evento: nenhum dado do evento pedido (R13).
export function eventNotFoundBody({ backHref, backLabel }) {
  return html`<h1>Evento não encontrado</h1>
    <p><a href="${backHref}">${backLabel}</a></p>`;
}
