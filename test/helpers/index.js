// Helpers de teste compartilhados por todas as features (F01 P-F01-7).
import { before, after } from 'node:test';
import { migrate } from '../../src/core/migrate.js';
import { loadModules, startModules } from '../../src/core/modules.js';
import { createApp } from '../../src/app.js';
import { pool, query } from '../../src/core/db.js';
import { seed, SEED_PASSWORD } from '../../src/seed.js';
import { toDateTimeLocalValue } from '../../src/core/time.js';

export const SEED = {
  password: SEED_PASSWORD,
  organizerA: 'organizador.a@catraca.dev',
  organizerB: 'organizador.b@catraca.dev',
  participant: 'participante@catraca.dev',
};
export const PARTNER_KEY = process.env.PARTNER_API_KEY || 'pk_test_catraca_parceiro';

// Apaga os dados de todas as tabelas (menos schema_migrations) e roda a seed. Retorna os usuários da seed.
export async function resetDb() {
  await migrate({ log: () => {} });
  const { rows } = await query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (rows.length > 0) {
    await query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  return seed({ log: () => {} });
}

// Sobe o app completo (todos os módulos) numa porta efêmera. workers=false não inicia o trabalho em
// segundo plano dos módulos (ex.: worker do gateway).
export async function startTestServer({ workers = true } = {}) {
  await migrate({ log: () => {} });
  const modules = await loadModules();
  const app = createApp(modules);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const stopWorkers = workers ? await startModules(modules) : async () => {};
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    modules,
    async close() {
      await stopWorkers();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function closeDb() {
  await pool.end();
}

// Registra before/after no arquivo de teste: banco limpo + seed + servidor. Devolve um objeto preenchido no
// before com { baseUrl, users, close }.
export function useTestApp(options = {}) {
  const ctx = {};
  before(async () => {
    ctx.users = await resetDb();
    Object.assign(ctx, await startTestServer(options));
  });
  after(async () => {
    if (ctx.close) await ctx.close();
    await closeDb();
  });
  return ctx;
}

// Cliente HTTP com cookie jar. Não segue redirecionamentos (o teste vê o 302 e o Location).
export function createClient(baseUrl) {
  const jar = new Map();

  async function request(method, path, { form, json, headers = {} } = {}) {
    const h = { ...headers };
    if (jar.size > 0) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form !== undefined) {
      body = new URLSearchParams(form).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (json !== undefined) {
      body = typeof json === 'string' ? json : JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(baseUrl + path, { method, headers: h, body, redirect: 'manual' });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), text, json: data };
  }

  return {
    jar,
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, form, opts) => request('POST', path, { ...opts, form }),
    postJson: (path, json, opts) => request('POST', path, { ...opts, json }),
    async login(email, password = SEED_PASSWORD) {
      const res = await request('POST', '/login', { form: { email, password } });
      if (res.status !== 302) throw new Error(`login de ${email} falhou: ${res.status}`);
      return res;
    },
    async logout() {
      return request('POST', '/logout');
    },
  };
}

// Valor de <input type="datetime-local"> daqui a N dias (negativo = passado), no fuso da Catraca.
export function localDateTimeInDays(days) {
  return toDateTimeLocalValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Repete fn até devolver algo truthy ou estourar o tempo.
export async function waitFor(fn, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: condição não atendida em ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}
