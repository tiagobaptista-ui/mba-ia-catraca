import { html } from '../../core/html.js';
import { formatDateTimeBR } from '../../core/time.js';
import { MESSAGES } from './service.js';

function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return html`<ul class="error" role="alert">${errors.map((e) => html`<li>${e}</li>`)}</ul>`;
}

function noticeBox(notice) {
  return notice ? html`<p class="notice" role="status">${notice}</p>` : '';
}

// Formulário só para evento publicado; o navegador pede confirmação antes do POST (irreversível).
function cancelForm(event) {
  return html`<p>O cancelamento é irreversível: o evento sai da vitrine e da API de parceiros, não vende mais e não
      pode ser editado nem republicado. Ingressos confirmados passam a estornados e pendentes, a cancelados.</p>
    <form method="post" action="/organizer/events/${event.id}/cancel" class="cancel-form">
      <button type="submit"
        onclick="return confirm('Cancelar este evento? Esta ação é irreversível: confirmados serão estornados e pendentes, cancelados.')">Cancelar evento</button>
    </form>`;
}

// Seção "cancel" (order 90) da página de gestão. result = { errors } (POST recusado) ou { notice } (sucesso).
// O título é "Cancelamento" em todos os estados: "Cancelar evento" só aparece no botão, que só existe no publicado.
export function cancelSection(event, result = {}) {
  const errors = result.errors || [];
  let content;
  if (event.status === 'published') {
    content = cancelForm(event);
  } else if (event.status === 'cancelled') {
    const when = event.cancelledAt ? ` em ${formatDateTimeBR(event.cancelledAt)}` : '';
    content = html`<p data-cancelled="true">Evento cancelado${when}.</p>`;
  } else {
    content = errors.includes(MESSAGES.onlyPublished) ? '' : html`<p class="muted">${MESSAGES.onlyPublished}</p>`;
  }
  return html`<h2>Cancelamento</h2>${noticeBox(result.notice)}${errorList(errors)}${content}`;
}
