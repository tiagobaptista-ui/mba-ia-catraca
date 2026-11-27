import { html } from '../../core/html.js';
import { formatDateTimeBR, toDateTimeLocalValue } from '../../core/time.js';
import { formatCents, centsToInput } from '../../core/money.js';
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

// ---- Formulário de evento (criar e editar) --------------------------------------------------------------

const FORM_FIELDS = ['name', 'startsAt', 'venue', 'capacity', 'price'];

// Valores do formulário a partir do que foi enviado (para reexibir com os erros).
export function formValuesFromInput(input = {}) {
  const values = {};
  for (const field of FORM_FIELDS) {
    const value = input[field];
    values[field] = value === undefined || value === null ? '' : String(value);
  }
  return values;
}

export function formValuesFromEvent(event) {
  return {
    name: event.name,
    startsAt: toDateTimeLocalValue(event.startsAt),
    venue: event.venue,
    capacity: String(event.capacity),
    price: centsToInput(event.priceCents),
  };
}

export function eventForm({ action, values = {}, submitLabel }) {
  return html`<form method="post" action="${action}" class="event-form">
    <label for="name">Nome</label>
    <input id="name" name="name" value="${values.name || ''}" maxlength="200" required>
    <label for="startsAt">Data e hora de início</label>
    <input id="startsAt" name="startsAt" type="datetime-local" value="${values.startsAt || ''}" required>
    <label for="venue">Local</label>
    <input id="venue" name="venue" value="${values.venue || ''}" maxlength="200" required>
    <label for="capacity">Lotação</label>
    <input id="capacity" name="capacity" type="number" min="1" step="1" value="${values.capacity || ''}" required>
    <label for="price">Preço (R$)</label>
    <input id="price" name="price" inputmode="decimal" placeholder="100,00" value="${values.price || ''}" required>
    <p><button type="submit">${submitLabel}</button></p>
  </form>`;
}

export function newEventBody({ values = {}, errors = [] } = {}) {
  return html`<p><a href="/organizer">← Meus eventos</a></p>
    <h1>Novo evento</h1>
    <p class="muted">O evento nasce como rascunho e só aparece na vitrine depois de publicado.</p>
    ${errorList(errors)}
    ${eventForm({ action: '/organizer/events', values, submitLabel: 'Criar evento' })}`;
}

// ---- Área do organizador --------------------------------------------------------------------------------

export function organizerListBody(events) {
  const list =
    events.length === 0
      ? html`<p class="muted">Você ainda não criou eventos.</p>`
      : html`<table>
          <thead><tr><th>Nome</th><th>Data e hora</th><th>Local</th><th>Status</th></tr></thead>
          <tbody>
            ${events.map(
              (e) => html`<tr data-event-id="${e.id}">
                <td><a href="/organizer/events/${e.id}">${e.name}</a></td>
                <td>${formatDateTimeBR(e.startsAt)}</td>
                <td>${e.venue}</td>
                <td>${statusLabel(e.status)}</td>
              </tr>`,
            )}
          </tbody>
        </table>`;
  return html`<h1>Área do organizador</h1>
    <p><a href="/organizer/events/new">Novo evento</a></p>
    <h2>Meus eventos</h2>
    ${list}`;
}

// ---- Seções nativas da página de gestão (details 0, publish 40, edit 50) ----------------------------------

export function detailsSection(event) {
  return html`<h2>Dados do evento</h2>
    <dl class="event-details">
      <dt>Status</dt><dd><strong data-status="${event.status}">${statusLabel(event.status)}</strong></dd>
      <dt>Data e hora</dt><dd>${formatDateTimeBR(event.startsAt)}</dd>
      <dt>Local</dt><dd>${event.venue}</dd>
      <dt>Lotação</dt><dd>${event.capacity}</dd>
      <dt>Preço</dt><dd>${formatCents(event.priceCents)}</dd>
    </dl>`;
}

const when = (date) => (date ? ` em ${formatDateTimeBR(date)}` : '');

export function publishSection(event, result = {}) {
  let content;
  if (event.status === 'draft') {
    content = html`<p>Rascunho: o evento ainda não aparece na vitrine.</p>
      <form method="post" action="/organizer/events/${event.id}/publish">
        <button type="submit">Publicar evento</button>
      </form>`;
  } else if (event.status === 'published') {
    content = html`<p>Publicado${when(event.publishedAt)}: o evento está à venda na vitrine.
      <a href="/events/${event.id}">Ver página pública</a></p>`;
  } else {
    content = html`<p>Cancelado${when(event.cancelledAt)}: o evento saiu da vitrine.</p>`;
  }
  return html`<h2>Publicação</h2>${errorList(result.errors)}${content}`;
}

export function editSection(event, result = {}) {
  if (event.status === 'cancelled') {
    return html`<h2>Edição</h2>
      ${errorList(result.errors)}
      <p>Evento cancelado: edição e publicação bloqueadas.</p>`;
  }
  const values = result.values || formValuesFromEvent(event);
  return html`<h2>Editar evento</h2>
    ${errorList(result.errors)}
    ${eventForm({ action: `/organizer/events/${event.id}`, values, submitLabel: 'Salvar alterações' })}`;
}

// ---- Vitrine --------------------------------------------------------------------------------------------

// cards: [{ event, extras }] (extras = renderStorefrontExtras(..., variant 'card'))
export function storefrontBody(cards) {
  const list =
    cards.length === 0
      ? html`<p class="muted">Nenhum evento à venda no momento.</p>`
      : cards.map(
          ({ event, extras }) => html`<article class="card" data-event-id="${event.id}">
            <h2><a href="/events/${event.id}">${event.name}</a></h2>
            ${eventFacts(event)}
            ${extras}
          </article>`,
        );
  return html`<h1>Eventos à venda</h1>${list}`;
}
