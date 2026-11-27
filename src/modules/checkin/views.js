import { html } from '../../core/html.js';
import { CHECKIN_MESSAGES } from './service.js';

// Resultado da última tentativa. O avaliador lê `data-result="<key>">mensagem` (data-result é o último atributo).
function resultBlock(result) {
  if (!result || !Object.hasOwn(CHECKIN_MESSAGES, result.key)) return '';
  return html`<p class="checkin-result" data-result="${result.key}">${result.message}</p>
    ${result.code ? html`<p class="muted">Código informado: <code class="checkin-code">${result.code}</code></p>` : ''}`;
}

function checkinForm(event, { focus }) {
  return html`<form method="post" action="/organizer/events/${event.id}/checkin" class="checkin-form">
    <label for="checkin-code">Código do ingresso</label>
    <input id="checkin-code" name="code" maxlength="64" autocomplete="off" autocapitalize="characters"
      spellcheck="false" required${focus ? html` autofocus` : ''}>
    <p><button type="submit">Validar entrada</button></p>
  </form>`;
}

// Seção "Check-in" da página de gestão (R04, R10). result = { key, message, code } do POST, ou undefined no GET.
// Rascunho nunca teve venda (só evento publicado vende, R02): sem tentativa, a seção não aparece. Em evento
// cancelado o campo continua disponível — vale a lista de R10 — com a nota "Evento cancelado".
export function checkinSection(event, result) {
  if (event.status === 'draft' && !result) return null;
  return html`<h2>Check-in</h2>
    ${event.status === 'cancelled' ? html`<p class="checkin-note" data-event-status="cancelled">Evento cancelado</p>` : ''}
    ${checkinForm(event, { focus: Boolean(result) })}
    ${resultBlock(result)}`;
}
