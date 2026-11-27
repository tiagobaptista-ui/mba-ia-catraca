#!/usr/bin/env node
// Fluxo do avaliador automatizado (F09): passos 2 a 16 de docs/fluxo-avaliador.md contra o produto no ar, pela
// borda (HTML + formulários e API de parceiros), com os tempos reais do gateway simulado.
//
//   WEB=http://localhost:3000 API=http://localhost:3000 KEY=pk_test_catraca_parceiro node scripts/fluxo-avaliador.mjs
//
// Sem dependências (fetch nativo, Node LTS) e sem nenhum import de src/: o script só fala HTTP. Cada ator
// (organizador A, organizador B, participante novo, participante da seed, visitante) é um cliente com cookie jar
// próprio, e os passos de interface usam os formulários que a própria página oferece, como o navegador faria.
// Cada verificação imprime ✔/✘ com o passo e a evidência; no fim, um resumo. Código de saída 0 só se tudo passar.
// Nomes e e-mails levam um sufixo único por execução: o fluxo pode rodar várias vezes no mesmo banco.
import { randomBytes } from 'node:crypto';

// ---- Configuração ---------------------------------------------------------------------------------------

const trimSlash = (url) => url.replace(/\/+$/, '');
const WEB = trimSlash(process.env.WEB || 'http://localhost:3000');
const API = trimSlash(process.env.API || 'http://localhost:3000');
const KEY = process.env.KEY || 'pk_test_catraca_parceiro';

const SEED_PASSWORD = 'catraca123';
const SEED = Object.freeze({
  organizerA: 'organizador.a@catraca.dev',
  organizerB: 'organizador.b@catraca.dev',
  participant: 'participante@catraca.dev',
});

// Cartões do gateway simulado (brief): 0001 aprova em 2–5 s, 0003 aprova em 30–40 s, 0004 recusa em 30–40 s.
const CARD = Object.freeze({
  approve: '4000000000000001',
  approveSlow: '4000000000000003',
  declineSlow: '4000000000000004',
});

// Sufixo único da execução (data/hora + aleatório), legível nos nomes dos eventos.
const RUN = `${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}-${randomBytes(2).toString('hex')}`;

const STARTED_AT = Date.now();

// ---- Relatório: ✔/✘ por verificação --------------------------------------------------------------------

const results = [];
let currentStep = null;

// Interrompe o fluxo: um passo seguinte depende do que falhou (ex.: o id do evento).
class FlowAborted extends Error {}

const clock = () => {
  const s = Math.floor((Date.now() - STARTED_AT) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function step(number, title) {
  currentStep = number;
  console.log(`\n[${clock()}] Passo ${number} — ${title}`);
}

// Registra uma verificação. → ok (boolean)
function check(ok, what, evidence = '') {
  const passed = Boolean(ok);
  results.push({ step: currentStep, ok: passed, what });
  console.log(`  ${passed ? '✔' : '✘'} [passo ${currentStep}] ${what}${evidence ? ` — ${evidence}` : ''}`);
  return passed;
}

// Verificação da qual o resto do fluxo depende: se falhar, interrompe.
function must(ok, what, evidence) {
  if (!check(ok, what, evidence)) throw new FlowAborted(what);
}

// Trecho curto de um texto (evidência), com espaços colapsados.
function snippet(text, max = 160) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

function info(message) {
  console.log(`    · ${message}`);
}

// ---- Tempo ----------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Espera de verdade até o instante `at` (ms), avisando quanto falta.
async function sleepUntil(at, reason) {
  const ms = at - Date.now();
  if (ms <= 0) return;
  info(`aguardando ${secs(ms)} (${reason})`);
  await sleep(ms);
}

// Repete fn() — que devolve { ok, value } — até ok ou até o instante `deadline` (ms).
// → { value, at } (at = instante da leitura que satisfez) ou { value: null, last } (último valor lido).
async function pollUntil(fn, { deadline, intervalMs = 100 }) {
  for (;;) {
    const { ok, value } = await fn();
    if (ok) return { value, at: Date.now() };
    if (Date.now() >= deadline) return { value: null, last: value };
    await sleep(intervalMs);
  }
}

// Datas no fuso da Catraca (America/Sao_Paulo, UTC−03:00), no formato de <input type="datetime-local">.
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = -3 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

function localInput(ms) {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 16); // 'AAAA-MM-DDTHH:MM'
}

// Dia `day` do mês seguinte, às `time`: sempre no futuro, com pelo menos duas semanas de folga.
function nextMonthInput(day, time) {
  const now = new Date(Date.now() + OFFSET_MS);
  const month = now.getUTCMonth() + 1; // mês atual em 1..12
  const year = now.getUTCFullYear() + (month === 12 ? 1 : 0);
  return `${year}-${pad((month % 12) + 1)}-${pad(day)}T${time}`;
}

// 'AAAA-MM-DDTHH:MM' → 'DD/MM/AAAA HH:MM' (como a interface exibe)
function brDateTime(input) {
  const [, y, mo, d, h, mi] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

// ---- Cliente web (um por ator, com cookie jar) ------------------------------------------------------------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class Browser {
  constructor(actor, base = WEB) {
    this.actor = actor;
    this.base = base;
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeCookies(res) {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = /expires=Thu, 01 Jan 1970/i.test(cookie) || /max-age=0\b/i.test(cookie);
      if (value === '' || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  // Uma requisição. form = objeto de campos (application/x-www-form-urlencoded). follow = segue redirecionamentos
  // com GET, como o navegador ao abrir um endereço. → { status, location, url, text, redirects }
  async request(method, path, { form, follow = false } = {}) {
    let url = new URL(path, this.base).href;
    let init = { method, body: form ? new URLSearchParams(form).toString() : undefined };
    const redirects = [];
    for (;;) {
      const headers = {};
      if (this.jar.size > 0) headers.cookie = this.cookieHeader();
      if (init.body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
      const res = await fetch(url, { ...init, headers, redirect: 'manual' });
      this.storeCookies(res);
      const text = await res.text();
      const location = res.headers.get('location');
      if (follow && REDIRECTS.has(res.status) && location && redirects.length < 5) {
        redirects.push(`${res.status} → ${location}`);
        url = new URL(location, url).href;
        init = { method: 'GET', body: undefined };
        continue;
      }
      return { status: res.status, location, url, text, redirects };
    }
  }

  get(path, opts) {
    return this.request('GET', path, opts);
  }

  post(path, form = {}, opts) {
    return this.request('POST', path, { ...opts, form });
  }

  // Envia um formulário lido da página (findForm) como o navegador: os valores já preenchidos na página mais os
  // digitados (`values`), que só podem ser de campos que o formulário tem.
  submit(form, values = {}) {
    const unknown = Object.keys(values).filter((name) => !Object.hasOwn(form.values, name));
    if (unknown.length > 0) {
      throw new FlowAborted(`campo(s) ${unknown.join(', ')} não existe(m) no formulário ${form.action}`);
    }
    return this.post(form.action, { ...form.values, ...values });
  }

  // Entra pelo formulário da página /login. → resposta do POST (302 + Location quando dá certo)
  async login(email, password = SEED_PASSWORD) {
    const page = await this.get('/login');
    const form = findForm(page.text, (f) => f.action === '/login');
    if (!form) throw new FlowAborted(`formulário de login não encontrado em GET /login (${page.status})`);
    return this.submit(form, { email, password });
  }
}

// ---- Cliente da API de parceiros -------------------------------------------------------------------------

// key = null: sem o cabeçalho X-Api-Key. body: objeto (vira JSON). → { status, text, json }
async function apiCall(method, path, { key = KEY, body } = {}) {
  const headers = {};
  if (key !== null) headers['X-Api-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

const api = {
  listEvents: (opts) => apiCall('GET', '/api/partner/events', opts),
  purchase: (eventId, body, opts) =>
    apiCall('POST', `/api/partner/events/${encodeURIComponent(eventId)}/purchases`, { ...opts, body }),
  ticket: (ticketId, opts) => apiCall('GET', `/api/partner/tickets/${encodeURIComponent(ticketId)}`, opts),
};

// ---- Leitura de HTML --------------------------------------------------------------------------------------

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s) => String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);

const attr = (attrs, name, fallback = '') => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? decode(match[1]) : fallback;
};

// Formulários POST da página: [{ action, values }] (values = { campo: valor preenchido na página }).
function formsOf(html) {
  return [...String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
    .map(([, attrs, inner]) => ({
      method: attr(attrs, 'method', 'get').toLowerCase(),
      action: attr(attrs, 'action'),
      values: Object.fromEntries(
        [...inner.matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)]
          .map(([, fieldAttrs]) => [attr(fieldAttrs, 'name'), attr(fieldAttrs, 'value')])
          .filter(([name]) => name !== ''),
      ),
    }))
    .filter((f) => f.method === 'post');
}

function findForm(html, predicate) {
  return formsOf(html).find(predicate) || null;
}

// Conteúdo do <main> (sem a navegação nem o CSS do layout).
function mainOf(html) {
  const match = /<main>([\s\S]*)<\/main>/.exec(String(html));
  return match ? match[1] : String(html);
}

// Texto visível de um trecho de HTML.
function textOf(html) {
  return decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function titleOf(html) {
  const match = /<title>([^<]*)<\/title>/.exec(String(html));
  return match ? decode(match[1]).trim() : '';
}

// Seção da página de gestão: <section data-section="<key>">…</section>; null se não aparece.
function sectionOf(html, key) {
  const match = new RegExp(`<section data-section="${key}">([\\s\\S]*?)</section>`).exec(String(html));
  return match ? match[1] : null;
}

// Card de um evento na vitrine: <article class="card" data-event-id="<id>">…</article>; null se não aparece.
function cardOf(html, eventId) {
  const match = new RegExp(`<article class="card" data-event-id="${eventId}">([\\s\\S]*?)</article>`).exec(String(html));
  return match ? match[1] : null;
}

const countMatches = (html, re) => (String(html).match(re) || []).length;

// Valor de um item dos dados do evento na página de gestão (seção "details"): <dt>Lotação</dt><dd>3</dd>.
function detailOf(html, label) {
  const match = new RegExp(`<dt>${label}</dt><dd>([\\s\\S]*?)</dd>`).exec(sectionOf(html, 'details') ?? '');
  return match ? textOf(match[1]) : null;
}

// Status do evento na página de gestão (data-status da seção "details").
function eventStatusOf(html) {
  const match = /data-status="([a-z]+)"/.exec(sectionOf(html, 'details') ?? '');
  return match ? match[1] : null;
}

// Mensagens de erro de formulário (<ul class="error">), como texto.
function errorsOf(html) {
  return [...String(html).matchAll(/<ul class="error"[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => textOf(m[1])).join(' | ');
}

// Painel (R12): <dd data-metric="<chave>">valor</dd>, com os rótulos de R12. → { chave: valor }
const METRIC_LABELS = Object.freeze({
  confirmed: 'Confirmados',
  pending: 'Pendentes',
  checkins: 'Check-ins',
  available: 'Vagas disponíveis',
  revenue: 'Receita',
  refunded: 'Estornados',
});

function metricsOf(html) {
  return Object.fromEntries(
    [...String(html ?? '').matchAll(/data-metric="([a-z]+)">([^<]*)</g)].map(([, key, value]) => [
      key,
      decode(value).trim(),
    ]),
  );
}

function describePanel(metrics) {
  return Object.entries(METRIC_LABELS)
    .map(([key, label]) => `${label} ${metrics[key] ?? '?'}`)
    .join(', ');
}

function samePanel(metrics, expected) {
  return Object.keys(METRIC_LABELS).every((key) => metrics[key] === String(expected[key]));
}

// Resultado do check-in (R10): data-result="<chave>">mensagem. → { key, message } ou null
function checkinResultOf(html) {
  const match = /data-result="([a-z_]+)">([^<]*)</.exec(String(html ?? ''));
  return match ? { key: match[1], message: decode(match[2]).trim() } : null;
}

// Linhas de "Meus ingressos" (R09): evento, status (valor e rótulo) e código de cada ingresso.
function myTicketsOf(html) {
  return [...String(html).matchAll(/<tr data-ticket-id="([^"]+)" data-event-id="([^"]+)">([\s\S]*?)<\/tr>/g)].map(
    ([, ticketId, eventId, inner]) => {
      const status = /data-status="([^"]+)">([^<]*)</.exec(inner);
      const code = /<code class="ticket-code">([^<]*)<\/code>/.exec(inner);
      return {
        ticketId,
        eventId,
        status: status ? status[1] : null,
        label: status ? decode(status[2]).trim() : null,
        code: code ? decode(code[1]).trim() : null,
      };
    },
  );
}

const describeTicketRow = (row) =>
  row ? `${row.label} (data-status="${row.status}"), código ${row.code}` : 'ingresso de E1 não listado';

// ---- Atores -----------------------------------------------------------------------------------------------

const actors = {
  A: new Browser('organizador A'),
  B: new Browser('organizador B'),
  seedParticipant: new Browser('participante da seed'),
  visitor: new Browser('visitante'),
  participant: null, // criado no passo 5
};

// ---- Ações da interface e da API usadas pelos passos -------------------------------------------------------

// Estado compartilhado entre os passos ($E1, $T2, códigos…).
const ctx = {};

const managementPath = (eventId) => `/organizer/events/${eventId}`;
const managementPage = (browser, eventId) => browser.get(managementPath(eventId));

// Cria um evento pelo formulário "Novo evento". → resposta do POST
async function submitNewEvent(browser, fields) {
  const page = await browser.get('/organizer/events/new');
  const form = findForm(page.text, (f) => f.action === '/organizer/events');
  if (!form) throw new FlowAborted(`formulário de novo evento não encontrado (GET /organizer/events/new → ${page.status})`);
  return browser.submit(form, fields);
}

// Cria o evento e devolve o id da página de gestão para onde a criação redireciona.
async function createEvent(browser, fields, label) {
  const res = await submitNewEvent(browser, fields);
  const id = res.status === 302 ? (/^\/organizer\/events\/([^/?#]+)$/.exec(res.location || '') || [])[1] : undefined;
  must(id, `${label} criado por ${browser.actor}`, `POST /organizer/events → ${res.status} Location ${res.location}`);
  return id;
}

// Publica pelo botão "Publicar evento" da página de gestão.
async function publishEvent(browser, eventId, label) {
  const page = await managementPage(browser, eventId);
  const form = findForm(page.text, (f) => f.action === `${managementPath(eventId)}/publish`);
  must(form, `página de gestão de ${label} oferece "Publicar"`, `GET ${managementPath(eventId)} → ${page.status}`);
  const res = await browser.submit(form);
  must(res.status === 302, `${label} publicado`, `POST ${form.action} → ${res.status} Location ${res.location}`);
}

// Painel lido na página de gestão (seção "dashboard"), comparado com o esperado.
async function expectPanel(browser, eventId, label, expected) {
  const page = await managementPage(browser, eventId);
  const metrics = metricsOf(sectionOf(page.text, 'dashboard'));
  return check(
    page.status === 200 && samePanel(metrics, expected),
    `painel de ${label}: ${describePanel(expected)}`,
    `GET ${managementPath(eventId)} → ${page.status}, data-metric: ${describePanel(metrics)}`,
  );
}

// Check-in pelo formulário da página de gestão. → { res, form, result } (form/result null se não houver)
async function checkin(browser, eventId, code) {
  const page = await managementPage(browser, eventId);
  const form = findForm(page.text, (f) => f.action === `${managementPath(eventId)}/checkin`);
  if (!form) return { res: page, form: null, result: null };
  const res = await browser.submit(form, { code });
  return { res, form, result: checkinResultOf(sectionOf(res.text, 'checkin')) };
}

function expectCheckin({ res, form, result }, code, label, expected) {
  return check(
    result?.message === expected,
    `${label} resulta em "${expected}"`,
    form
      ? `POST ${form.action} (code ${code}) → ${res.status}, data-result="${result?.key}">${result?.message}`
      : `formulário de check-in ausente (GET → ${res.status})`,
  );
}

// Compra pela API que precisa ser aceita (202 pending). → { id, code, sentAt, doneAt }
async function partnerBuy(eventId, label, buyerEmail, cardNumber) {
  const sentAt = Date.now();
  const res = await api.purchase(eventId, { buyerEmail, cardNumber });
  const doneAt = Date.now();
  must(
    res.status === 202 && res.json?.status === 'pending' && res.json.ticketId && res.json.code,
    `compra ${label} pela API com o cartão ${cardNumber}: 202 pending`,
    `POST /api/partner/events/${eventId}/purchases → ${res.status} ${res.text}`,
  );
  return { id: res.json.ticketId, code: res.json.code, sentAt, doneAt };
}

// Consulta o ingresso na API até ficar com `status`; verifica que isso aconteceu em até `withinMs` da compra.
async function expectTicketStatus(ticket, status, withinMs, what) {
  const polled = await pollUntil(
    async () => {
      const res = await api.ticket(ticket.id);
      return { ok: res.json?.status === status, value: res.json ?? res.text };
    },
    { deadline: ticket.doneAt + withinMs + 5000 },
  );
  const elapsed = polled.value ? polled.at - ticket.doneAt : null;
  return check(
    polled.value && elapsed <= withinMs,
    what,
    polled.value
      ? `${status} ${secs(elapsed)} depois da compra: ${JSON.stringify(polled.value)}`
      : `ainda ${JSON.stringify(polled.last)} ${secs(withinMs + 5000)} depois da compra`,
  );
}

// ---- Passos 2–11 ------------------------------------------------------------------------------------------

async function passo2() {
  step(2, 'E1 criado sem publicar: fora da vitrine e da API');
  const { A, visitor } = actors;
  ctx.e1 = {
    name: `E1 Jazz no Porão ${RUN}`,
    startsAt: nextMonthInput(15, '21:00'),
    venue: `Porão do Fluxo ${RUN}`,
    capacity: '2',
    price: '100,00',
  };
  ctx.E1 = await createEvent(A, ctx.e1, `E1 (lotação 2, R$ 100,00, ${brDateTime(ctx.e1.startsAt)})`);
  const page = await managementPage(A, ctx.E1);
  check(
    page.status === 200 && eventStatusOf(page.text) === 'draft',
    'E1 fica em rascunho (sem publicar)',
    `GET ${managementPath(ctx.E1)} → ${page.status}, data-status="${eventStatusOf(page.text)}"`,
  );

  const home = await visitor.get('/');
  check(
    home.status === 200 && !home.text.includes(ctx.E1) && !home.text.includes(ctx.e1.name),
    'deslogado, a vitrine não mostra E1',
    `GET / → ${home.status}, ${countMatches(home.text, /<article class="card"/g)} eventos à venda, nenhum é ${ctx.E1}`,
  );
  const publicPage = await visitor.get(`/events/${ctx.E1}`);
  check(
    publicPage.status === 404 && !publicPage.text.includes(ctx.e1.name),
    'deslogado, a página pública de E1 não existe',
    `GET /events/${ctx.E1} → ${publicPage.status} "${titleOf(publicPage.text)}"`,
  );
  const list = await api.listEvents();
  check(
    list.status === 200 && Array.isArray(list.json) && !list.json.some((e) => e.id === ctx.E1),
    'a listagem da API não mostra E1',
    `GET /api/partner/events → ${list.status}, ${list.json?.length} eventos, nenhum com id ${ctx.E1}`,
  );
}

async function passo3() {
  step(3, 'criar evento com a data de ontem é rejeitado');
  const name = `E-ontem ${RUN}`;
  const yesterday = localInput(Date.now() - DAY_MS);
  const res = await submitNewEvent(actors.A, { ...ctx.e1, name, startsAt: yesterday });
  check(
    res.status >= 400 && res.status < 500 && !res.location,
    'a criação é rejeitada',
    `POST /organizer/events (startsAt ${yesterday}) → ${res.status}: ${errorsOf(res.text)}`,
  );
  const list = await actors.A.get('/organizer');
  check(
    list.status === 200 && !list.text.includes(name),
    'nenhum evento foi criado',
    `GET /organizer → ${list.status}, "${name}" ausente da lista de A`,
  );
}

async function passo4() {
  step(4, 'E1 publicado: na vitrine e na API com availableSeats 2 e priceCents 10000');
  await publishEvent(actors.A, ctx.E1, 'E1');
  const home = await actors.visitor.get('/');
  const card = cardOf(home.text, ctx.E1);
  check(
    home.status === 200 && card?.includes(ctx.e1.name),
    'E1 aparece na vitrine',
    `GET / → ${home.status}, card ${ctx.E1}: ${snippet(textOf(card), 120)}`,
  );
  const list = await api.listEvents();
  const item = Array.isArray(list.json) ? list.json.find((e) => e.id === ctx.E1) : undefined;
  must(item, 'E1 aparece na listagem da API ($E1 guardado)', `GET /api/partner/events → ${list.status}, E1=${item?.id}`);
  check(
    item.availableSeats === 2 && item.priceCents === 10000 && item.name === ctx.e1.name,
    'na API, E1 tem availableSeats 2 e priceCents 10000',
    JSON.stringify(item),
  );
}

async function passo5() {
  step(5, 'participante novo compra E1 na vitrine: pendente e, em até 5 s, confirmado');
  const participant = new Browser('participante novo');
  actors.participant = participant;
  const email = `participante.${RUN}@example.com`;
  const signupPage = await participant.get('/signup');
  const signupForm = findForm(signupPage.text, (f) => f.action === '/signup');
  must(signupForm, 'a interface oferece o cadastro de participante', `GET /signup → ${signupPage.status}`);
  const signup = await participant.submit(signupForm, { name: `Participante ${RUN}`, email, password: 'fluxo-avaliador' });
  must(
    signup.status === 302 && participant.jar.size > 0,
    'conta de participante criada pela interface (já entra logado)',
    `POST /signup (${email}) → ${signup.status} Location ${signup.location}`,
  );

  const eventPage = await participant.get(`/events/${ctx.E1}`);
  const buyForm = findForm(eventPage.text, (f) => f.action === `/events/${ctx.E1}/purchase`);
  must(buyForm, 'a página de E1 oferece a compra ao participante', `GET /events/${ctx.E1} → ${eventPage.status}`);
  const bought = await participant.submit(buyForm, { cardNumber: CARD.approve });
  const boughtAt = Date.now();
  must(
    bought.status === 302 && bought.location === '/my-tickets',
    `compra de E1 na vitrine com o cartão ${CARD.approve}`,
    `POST ${buyForm.action} → ${bought.status} Location ${bought.location}`,
  );

  const rowOfE1 = async () => myTicketsOf((await participant.get('/my-tickets')).text).find((t) => t.eventId === ctx.E1);
  const first = await rowOfE1();
  check(
    first?.status === 'pending' && first.label === 'pendente',
    'em "Meus ingressos" o ingresso aparece pendente',
    `GET /my-tickets ${secs(Date.now() - boughtAt)} depois → ${describeTicketRow(first)}`,
  );
  const polled = await pollUntil(
    async () => {
      const row = await rowOfE1();
      return { ok: row?.status === 'confirmed', value: row };
    },
    { deadline: boughtAt + 10_000 },
  );
  const elapsed = polled.value ? polled.at - boughtAt : null;
  check(
    polled.value?.label === 'confirmado' && elapsed <= 5000,
    'em até 5 s (recarregando a página) o ingresso está confirmado',
    polled.value
      ? `confirmado ${secs(elapsed)} depois da compra (recarregando /my-tickets): ${describeTicketRow(polled.value)}`
      : `ainda ${describeTicketRow(polled.last)} 10 s depois da compra`,
  );
  ctx.C1 = (polled.value ?? first)?.code;
  if (!ctx.C1) throw new FlowAborted('código C1 não encontrado em "Meus ingressos"');
  info(`C1 = ${ctx.C1}`);
}

async function passo6() {
  step(6, `compra de E1 pela API com o cartão ${CARD.declineSlow} (T2)`);
  const t2 = await partnerBuy(ctx.E1, 'de E1 (T2)', 't2@example.com', CARD.declineSlow);
  ctx.t2 = t2;
  ctx.T2 = t2.id;
  ctx.C2 = t2.code;
  info(`$T2 = ${ctx.T2}, C2 = ${ctx.C2}`);
  const list = await api.listEvents();
  const item = list.json?.find?.((e) => e.id === ctx.E1);
  check(item?.availableSeats === 0, 'a listagem passa a mostrar E1 com availableSeats 0', JSON.stringify(item));
}

async function passo7() {
  step(7, 'antes de 30 s do passo 6: sold_out na API e "Ingressos esgotados" na vitrine');
  const res = await api.purchase(ctx.E1, { buyerEmail: 't-esgotado@example.com', cardNumber: CARD.approve });
  const apiAfter = Date.now() - ctx.t2.sentAt;
  check(
    res.status === 409 && res.json?.error === 'sold_out' && apiAfter < 30_000,
    `compra de E1 pela API com o cartão ${CARD.approve} responde 409 sold_out (antes de 30 s)`,
    `${res.status} ${res.text}, ${secs(apiAfter)} depois do passo 6`,
  );
  const page = await actors.participant.get(`/events/${ctx.E1}`);
  const pageAfter = Date.now() - ctx.t2.sentAt;
  const soldOut = mainOf(page.text).includes('Ingressos esgotados');
  const hasBuyForm = Boolean(findForm(page.text, (f) => f.action === `/events/${ctx.E1}/purchase`));
  check(
    page.status === 200 && soldOut && !hasBuyForm && pageAfter < 30_000,
    'a vitrine exibe "Ingressos esgotados" ao participante do passo 5, no lugar da compra',
    `GET /events/${ctx.E1} → ${page.status}, "Ingressos esgotados" ${soldOut ? 'presente' : 'ausente'}, ` +
      `formulário de compra ${hasBuyForm ? 'presente' : 'ausente'}, ${secs(pageAfter)} depois do passo 6`,
  );
  const home = await actors.participant.get('/');
  const card = cardOf(home.text, ctx.E1);
  check(
    card?.includes('Ingressos esgotados'),
    'na lista da vitrine, o card de E1 também exibe "Ingressos esgotados"',
    `GET / → ${home.status}, card ${ctx.E1}: ${snippet(textOf(card), 120)}`,
  );
}

async function passo8() {
  step(8, 'passados 45 s do passo 6: T2 declined, E1 com availableSeats 1; T3 confirmado em até 5 s');
  await sleepUntil(ctx.t2.doneAt + 45_000, `45 s do passo 6; o cartão ${CARD.declineSlow} responde em 30–40 s`);
  const t2 = await api.ticket(ctx.T2);
  check(
    t2.status === 200 && t2.json?.status === 'declined',
    '$T2 está declined',
    `GET /api/partner/tickets/${ctx.T2} → ${t2.status} ${t2.text} (${secs(Date.now() - ctx.t2.doneAt)} depois do passo 6)`,
  );
  const list = await api.listEvents();
  const item = list.json?.find?.((e) => e.id === ctx.E1);
  check(item?.availableSeats === 1, 'E1 volta a ter availableSeats 1', JSON.stringify(item));
  const t3 = await partnerBuy(ctx.E1, 'de E1 (T3)', 't3@example.com', CARD.approve);
  ctx.e1Codes = [ctx.C1, ctx.C2, t3.code];
  await expectTicketStatus(t3, 'confirmed', 5000, 'em até 5 s, T3 está confirmed');
}

async function passo9() {
  step(9, 'lotação 1 rejeitada; preço R$ 150,00 e lotação 3 aceitos; T4; painel de E1');
  const { A } = actors;
  const editForm = (html) => findForm(html, (f) => f.action === managementPath(ctx.E1));
  let page = await managementPage(A, ctx.E1);
  must(editForm(page.text), 'a página de gestão de E1 oferece a edição', `GET ${managementPath(ctx.E1)} → ${page.status}`);

  const reduce = await A.submit(editForm(page.text), { capacity: '1' });
  page = await managementPage(A, ctx.E1);
  check(
    reduce.status >= 400 && reduce.status < 500 && !reduce.location && detailOf(page.text, 'Lotação') === '2',
    'reduzir a lotação de E1 para 1 é rejeitado',
    `POST ${managementPath(ctx.E1)} (capacity 1) → ${reduce.status}: ${errorsOf(reduce.text)}; ` +
      `lotação continua ${detailOf(page.text, 'Lotação')}`,
  );

  const update = await A.submit(editForm(page.text), { capacity: '3', price: '150,00' });
  page = await managementPage(A, ctx.E1);
  check(
    update.status === 302 && detailOf(page.text, 'Lotação') === '3' && detailOf(page.text, 'Preço') === 'R$ 150,00',
    'mudar o preço para R$ 150,00 e a lotação para 3 é aceito',
    `POST ${managementPath(ctx.E1)} → ${update.status} Location ${update.location}; ` +
      `gestão: lotação ${detailOf(page.text, 'Lotação')}, preço ${detailOf(page.text, 'Preço')}`,
  );

  const t4 = await partnerBuy(ctx.E1, 'de E1 (T4)', 't4@example.com', CARD.approve);
  ctx.e1Codes.push(t4.code);
  await expectTicketStatus(t4, 'confirmed', 10_000, 'T4 confirmado (espera a confirmação)');
  await expectPanel(A, ctx.E1, 'E1', {
    confirmed: 3,
    pending: 0,
    checkins: 0,
    available: 0,
    revenue: 'R$ 350,00',
    refunded: 0,
  });
}

async function passo10() {
  step(10, 'check-in de E1; painel com Check-ins 1');
  const cases = [
    [ctx.C1, 'C1', 'Entrada liberada'],
    [ctx.C1, 'C1 de novo', 'Ingresso já utilizado'],
    [ctx.C2, 'C2', 'Ingresso não confirmado'],
    ['ZZZZZZZZ', 'ZZZZZZZZ', 'Ingresso inválido para este evento'],
  ];
  for (const [code, label, expected] of cases) {
    expectCheckin(await checkin(actors.A, ctx.E1, code), code, label, expected);
  }
  await expectPanel(actors.A, ctx.E1, 'E1', {
    confirmed: 3,
    pending: 0,
    checkins: 1,
    available: 0,
    revenue: 'R$ 350,00',
    refunded: 0,
  });
  ctx.e1Url = `${WEB}${managementPath(ctx.E1)}`;
  info(`endereço da página de gestão de E1 copiado: ${ctx.e1Url}`);
}

// Abrir o endereço copiado da gestão de E1 (como o navegador: seguindo redirecionamentos) não pode exibir nenhum
// dado de E1: nome, local, data, números (painel, dados do evento), ingressos (códigos). O id no endereço não conta.
async function expectNoE1Data(browser, who) {
  const res = await browser.get(ctx.e1Url, { follow: true });
  const fingerprints = [
    ctx.e1.name,
    ctx.e1.venue,
    brDateTime(ctx.e1.startsAt),
    'R$ 150,00',
    'R$ 350,00',
    ...ctx.e1Codes,
    'data-metric=',
    'data-section=',
    'data-result=',
    'data-ticket-id=',
  ];
  const page = `${res.text}\n${decode(res.text)}`;
  const leaks = fingerprints.filter((f) => page.includes(f));
  const route = [...res.redirects, `${res.status} "${titleOf(res.text)}"`].join(', ');
  return check(
    leaks.length === 0,
    `${who}, abrir o endereço copiado não exibe nenhum dado de E1`,
    `GET ${managementPath(ctx.E1)} → ${route}; ${leaks.length ? `exibiu: ${leaks.join(', ')}` : 'sem nome, local, data, números nem ingressos de E1'}`,
  );
}

async function passo11() {
  step(11, 'isolamento: B, participante da seed e visitante não veem E1; C3 de outro organizador é inválido em E1');
  const { A, B, seedParticipant, visitor } = actors;
  const list = await B.get('/organizer');
  check(
    list.status === 200 && !list.text.includes(ctx.E1) && !list.text.includes(ctx.e1.name),
    'como B, a lista de eventos da área de organizador não mostra E1',
    `GET /organizer → ${list.status}, ${countMatches(list.text, /<tr data-event-id=/g)} eventos de B, nenhum é E1`,
  );
  await expectNoE1Data(B, 'como B');

  ctx.e2 = {
    name: `E2 Sarau ${RUN}`,
    startsAt: nextMonthInput(20, '20:00'),
    venue: `Sala do B ${RUN}`,
    capacity: '1',
    price: '20,00',
  };
  const createdE2 = await createEvent(B, ctx.e2, 'E2 (lotação 1, R$ 20,00)');
  await publishEvent(B, createdE2, 'E2');
  const listed = await api.listEvents();
  const item = Array.isArray(listed.json) ? listed.json.find((e) => e.name === ctx.e2.name) : undefined;
  must(
    item?.id === createdE2,
    'o id de E2 vem da listagem da API',
    `GET /api/partner/events → ${listed.status}, ${JSON.stringify(item)}`,
  );
  ctx.E2 = item.id;
  const c3 = await partnerBuy(ctx.E2, 'de E2', 'c3@example.com', CARD.approve);
  ctx.C3 = c3.code;
  info(`C3 = ${ctx.C3}`);

  await expectNoE1Data(seedParticipant, 'como o participante da seed');
  await expectNoE1Data(visitor, 'deslogado');

  expectCheckin(await checkin(A, ctx.E1, ctx.C3), ctx.C3, 'de volta como A, C3 (de E2, do organizador B) no check-in de E1', 'Ingresso inválido para este evento');
}

// ---- Passos -----------------------------------------------------------------------------------------------

const STEPS = [passo2, passo3, passo4, passo5, passo6, passo7, passo8, passo9, passo10, passo11];

// ---- Execução ---------------------------------------------------------------------------------------------

// Pré-condições do passo 1: produto no ar, contas da seed e chave de parceiro funcionando.
async function preflight() {
  step('pré', 'produto no ar, contas da seed e chave de parceiro');
  let res;
  try {
    res = await fetch(`${WEB}/healthz`);
  } catch (err) {
    must(false, `WEB responde em ${WEB}/healthz`, `${err.cause?.code || err.message} (suba com ./scripts/up.sh)`);
  }
  const body = (await res.text()).trim();
  must(res.status === 200 && body === 'ok', `WEB responde em ${WEB}/healthz`, `${res.status} ${snippet(body, 40)}`);

  const logins = [
    [actors.A, SEED.organizerA, '/organizer'],
    [actors.B, SEED.organizerB, '/organizer'],
    [actors.seedParticipant, SEED.participant, '/'],
  ];
  for (const [browser, email, home] of logins) {
    const login = await browser.login(email);
    must(
      login.status === 302 && login.location === home && browser.jar.size > 0,
      `${browser.actor} entra com a senha da seed`,
      `POST /login (${email}) → ${login.status} Location ${login.location}`,
    );
  }

  const list = await api.listEvents();
  must(
    list.status === 200 && Array.isArray(list.json),
    'chave de parceiro aceita pela API',
    `GET ${API}/api/partner/events → ${list.status}, ${Array.isArray(list.json) ? `${list.json.length} eventos` : snippet(list.text, 80)}`,
  );
}

function summary(aborted) {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n────────────────────────────────────────────────────────────────────────');
  if (aborted) console.log(`Fluxo interrompido no passo ${aborted.step}: ${aborted.reason}`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ✘ [passo ${r.step}] ${r.what}`);
  console.log(`Resumo: ${results.length} verificações — ${passed} ✔, ${failed} ✘ — tempo total ${secs(Date.now() - STARTED_AT)}`);
  console.log(`WEB=${WEB} API=${API} execução ${RUN}`);
  const ok = !aborted && failed === 0;
  console.log(ok ? 'RESULTADO: todas as verificações passaram.' : 'RESULTADO: há falhas.');
  return ok;
}

async function main() {
  console.log(`Fluxo do avaliador (passos 2–16) — WEB=${WEB} API=${API} execução ${RUN}`);
  let aborted = null;
  try {
    await preflight();
    for (const run of STEPS) await run();
  } catch (err) {
    const reason = err instanceof FlowAborted ? err.message : `erro inesperado: ${err.cause?.code || err.stack || err}`;
    if (!(err instanceof FlowAborted)) check(false, 'execução sem erro inesperado', snippet(reason, 300));
    aborted = { step: currentStep, reason };
  }
  process.exitCode = summary(aborted) ? 0 : 1;
}

await main();
