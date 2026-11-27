// Pontos de extensão de F02 (PRD P-F02-3, P-F02-4). Outras features se plugam aqui, sem editar F02:
//   - setCapacityGuard(fn)                         R03 (F04 registra o guard real)
//   - addManagementSection({ key, order, render }) seções da página de gestão (painel, check-in, cancelamento…)
//   - renderManagementPage(req, res, event, opts)   devolve o resultado de um POST na própria página de gestão
//   - addStorefrontExtra({ key, order, render })   extras da vitrine e da página pública (vagas, compra…)
//   - renderEventPage(req, res, event, opts)        página pública do evento com os extras
//   - loadOwnedEvent                                middleware: evento do organizador logado ou 404 (R13)
import { html } from '../../core/html.js';
import { sendPage } from '../../core/layout.js';
import { getOwnedEvent } from './service.js';
import { eventFacts, eventNotFoundBody, noticeBox } from './views.js';

export { setCapacityGuard } from './service.js';

const DEFAULT_ORDER = 100;
const managementSections = new Map();
const storefrontExtras = new Map();

function normalizeEntry(kind, entry) {
  if (!entry || typeof entry.key !== 'string' || entry.key === '') {
    throw new TypeError(`${kind}: informe uma key (texto não vazio)`);
  }
  if (typeof entry.render !== 'function') throw new TypeError(`${kind}: render precisa ser uma função`);
  const order = Number.isFinite(entry.order) ? entry.order : DEFAULT_ORDER;
  return { key: entry.key, order, render: entry.render };
}

function sortedEntries(map) {
  return [...map.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

// Conteúdo vazio (null, undefined, false, '') → a seção/extra não aparece.
function isEmpty(content) {
  return content === null || content === undefined || content === false || String(content) === '';
}

// ---- Página de gestão (R04) ----------------------------------------------------------------------------

// Registra (ou substitui, pela key) uma seção da página de gestão.
// render({ event, user, result, req }) → html (pode ser async); result = results[key] do renderManagementPage.
// Ordens: F02 details 0, publish 40, edit 50; reservadas: painel 10, check-in 20, cancelamento 90.
export function addManagementSection(entry) {
  const section = normalizeEntry('addManagementSection', entry);
  managementSections.set(section.key, section);
}

export function removeManagementSection(key) {
  managementSections.delete(key);
}

export function listManagementSections() {
  return sortedEntries(managementSections).map(({ key, order }) => ({ key, order }));
}

async function renderManagementSections({ event, req, results }) {
  const sections = sortedEntries(managementSections);
  const contents = await Promise.all(
    sections.map((s) => s.render({ event, user: req.user, result: results[s.key], req })),
  );
  return sections.map((s, i) =>
    isEmpty(contents[i]) ? '' : html`<section data-section="${s.key}">${contents[i]}</section>`,
  );
}

// Renderiza a página de gestão com todas as seções ordenadas, cada uma em <section data-section="<key>">.
export async function renderManagementPage(req, res, event, { status = 200, results = {}, notice = null } = {}) {
  const sections = await renderManagementSections({ event, req, results });
  return sendPage(res, {
    status,
    title: event.name,
    user: req.user,
    body: html`<p><a href="/organizer">← Meus eventos</a></p>
      <h1>${event.name}</h1>
      ${noticeBox(notice)}
      ${sections}`,
  });
}

// 404 sem nenhum dado do evento (R13). backHref/backLabel apontam para a área de origem.
export function sendEventNotFound(req, res, { backHref = '/', backLabel = 'Voltar à vitrine' } = {}) {
  return sendPage(res, {
    status: 404,
    title: 'Evento não encontrado',
    user: req.user,
    body: eventNotFoundBody({ backHref, backLabel }),
  });
}

// Middleware das rotas /organizer/events/:id (e sub-rotas de outras features): carrega o evento do organizador
// logado em req.event; se não existir ou for de outro organizador → 404 "Evento não encontrado" (R13).
export async function loadOwnedEvent(req, res, next) {
  const user = req.user;
  const event = user && user.role === 'organizer' ? await getOwnedEvent(user.id, req.params.id) : null;
  if (!event) {
    return sendEventNotFound(req, res, { backHref: '/organizer', backLabel: 'Voltar à área do organizador' });
  }
  req.event = event;
  return next();
}

// ---- Vitrine e página pública ---------------------------------------------------------------------------

// Registra (ou substitui, pela key) um extra da vitrine/página pública.
// render({ event, user, variant: 'card' | 'page', req, result }) → html (pode ser async).
// Também aceita só a função render (key gerada).
export function addStorefrontExtra(entryOrRender) {
  const entry =
    typeof entryOrRender === 'function'
      ? { key: `extra-${storefrontExtras.size + 1}`, render: entryOrRender }
      : entryOrRender;
  const extra = normalizeEntry('addStorefrontExtra', entry);
  storefrontExtras.set(extra.key, extra);
}

export function removeStorefrontExtra(key) {
  storefrontExtras.delete(key);
}

// Extras de um evento, cada um em <div data-extra="<key>">.
export async function renderStorefrontExtras(event, { variant, req, results = {} }) {
  const extras = sortedEntries(storefrontExtras);
  const contents = await Promise.all(
    extras.map((x) => x.render({ event, user: req.user, variant, req, result: results[x.key] })),
  );
  return extras.map((x, i) =>
    isEmpty(contents[i]) ? '' : html`<div class="extra" data-extra="${x.key}">${contents[i]}</div>`,
  );
}

// Página pública do evento com os extras (variant 'page'). Usada pelo GET de F02 e pelos POSTs de outras
// features (ex.: compra) para devolver o resultado na própria página.
export async function renderEventPage(req, res, event, { status = 200, results = {} } = {}) {
  const extras = await renderStorefrontExtras(event, { variant: 'page', req, results });
  return sendPage(res, {
    status,
    title: event.name,
    user: req.user,
    body: html`<p><a href="/">← Vitrine</a></p>
      <article class="event" data-event-id="${event.id}">
        <h1>${event.name}</h1>
        ${eventFacts(event)}
        ${extras}
      </article>`,
  });
}
