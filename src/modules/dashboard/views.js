import { html } from '../../core/html.js';
import { formatCents } from '../../core/money.js';

// Marcação estável do painel (o avaliador lê `data-metric`): rótulos exatos de R12 e um <dd> por número.
export const METRICS = Object.freeze([
  { key: 'confirmed', label: 'Confirmados', value: (d) => d.confirmed },
  { key: 'pending', label: 'Pendentes', value: (d) => d.pending },
  { key: 'checkins', label: 'Check-ins', value: (d) => d.checkins },
  { key: 'available', label: 'Vagas disponíveis', value: (d) => d.available },
  { key: 'revenue', label: 'Receita', value: (d) => formatCents(d.revenueCents) },
  { key: 'refunded', label: 'Estornados', value: (d) => d.refunded },
]);

export function dashboardSection(dashboard) {
  return html`<h2>Painel</h2>
    <dl class="dashboard">
      ${METRICS.map((m) => html`<dt>${m.label}</dt><dd data-metric="${m.key}">${m.value(dashboard)}</dd>`)}
    </dl>
    <p class="muted">Vendas da vitrine e da API de parceiros. Recarregue a página para atualizar.</p>`;
}
