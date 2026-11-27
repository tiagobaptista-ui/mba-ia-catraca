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

  // Envia um formulário lido da página (findForm), só com campos que o formulário tem, como o navegador.
  submit(form, values = {}) {
    const unknown = Object.keys(values).filter((name) => !form.fields.includes(name));
    if (unknown.length > 0) {
      throw new FlowAborted(`campo(s) ${unknown.join(', ')} não existe(m) no formulário ${form.action}`);
    }
    return this.post(form.action, values);
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

// Formulários POST da página: [{ action, fields }] (fields = nomes dos campos).
function formsOf(html) {
  return [...String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
    .map(([, attrs, inner]) => ({
      method: attr(attrs, 'method', 'get').toLowerCase(),
      action: attr(attrs, 'action'),
      fields: [...inner.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]*)"/g)].map((m) => decode(m[1])),
    }))
    .filter((f) => f.method === 'post');
}

function findForm(html, predicate) {
  return formsOf(html).find(predicate) || null;
}

// ---- Atores -----------------------------------------------------------------------------------------------

const actors = {
  A: new Browser('organizador A'),
  B: new Browser('organizador B'),
  seedParticipant: new Browser('participante da seed'),
  visitor: new Browser('visitante'),
  participant: null, // criado no passo 5
};

// ---- Passos -----------------------------------------------------------------------------------------------

const STEPS = [];

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
