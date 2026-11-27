import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { seed } from '../../src/seed.js';

const app = useTestApp({ workers: false });

test('F01-CA06: seed cria 2 organizadores e 1 participante e é idempotente', async () => {
  await seed({ log: () => {} });
  await seed({ log: () => {} });
  const { rows } = await query('SELECT email, role FROM users ORDER BY email');
  assert.deepEqual(rows, [
    { email: SEED.organizerA, role: 'organizer' },
    { email: SEED.organizerB, role: 'organizer' },
    { email: SEED.participant, role: 'participant' },
  ]);
  const c = createClient(app.baseUrl);
  await c.login(SEED.organizerA); // credenciais continuam válidas depois de reexecutar a seed
});

test('F01-CA05: visitante cria conta de participante, entra e sai', async () => {
  const c = createClient(app.baseUrl);
  const signup = await c.post('/signup', { name: 'Ana Teste', email: 'Ana.Teste@Example.com', password: 'segredo1' });
  assert.equal(signup.status, 302);
  assert.equal(signup.location, '/');
  const home = await c.get('/');
  assert.match(home.text, /Ana Teste/);
  assert.match(home.text, /Sair/);
  assert.match(home.text, /Meus ingressos/);

  const logout = await c.logout();
  assert.equal(logout.status, 302);
  const afterLogout = await c.get('/');
  assert.doesNotMatch(afterLogout.text, /Sair/);

  const login = await c.post('/login', { email: 'ana.teste@example.com', password: 'segredo1' });
  assert.equal(login.status, 302);
  assert.equal(login.location, '/');
});

test('F01-CA05: cadastro inválido ou repetido é rejeitado com mensagem', async () => {
  const c = createClient(app.baseUrl);
  await c.post('/signup', { name: 'Bia', email: 'bia@example.com', password: 'segredo1' });
  const dup = await createClient(app.baseUrl).post('/signup', { name: 'Bia 2', email: 'BIA@example.com', password: 'segredo1' });
  assert.equal(dup.status, 422);
  assert.match(dup.text, /E-mail já cadastrado/);

  const bad = await createClient(app.baseUrl).post('/signup', { name: '', email: 'invalido', password: '123' });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /E-mail inválido/);
  assert.match(bad.text, /Informe o nome/);
  assert.match(bad.text, /pelo menos 6 caracteres/);
});

test('F01-CA06: o cadastro nunca cria organizador', async () => {
  const c = createClient(app.baseUrl);
  await c.post('/signup', { name: 'Hacker', email: 'hacker@example.com', password: 'segredo1', role: 'organizer' });
  const { rows } = await query("SELECT role FROM users WHERE email = 'hacker@example.com'");
  assert.equal(rows[0].role, 'participant');
  const area = await c.get('/organizer');
  assert.equal(area.status, 403);
});

test('login inválido responde 401 com mensagem genérica', async () => {
  const c = createClient(app.baseUrl);
  const res = await c.post('/login', { email: SEED.organizerA, password: 'errada' });
  assert.equal(res.status, 401);
  assert.match(res.text, /E-mail ou senha inválidos/);
});

test('F01-CA07 (R13): visitante vai para o login e participante recebe 403 na área do organizador', async () => {
  const visitor = createClient(app.baseUrl);
  const v = await visitor.get('/organizer');
  assert.equal(v.status, 302);
  assert.equal(v.location, '/login?next=%2Forganizer');
  const vSub = await visitor.get('/organizer/events/evt_qualquer');
  assert.equal(vSub.status, 302);

  const participant = createClient(app.baseUrl);
  await participant.login(SEED.participant);
  const p = await participant.get('/organizer');
  assert.equal(p.status, 403);
  assert.match(p.text, /Acesso restrito/);
  const pSub = await participant.post('/organizer/events', { name: 'x' });
  assert.equal(pSub.status, 403);
});

test('organizador entra e é levado à área do organizador', async () => {
  const c = createClient(app.baseUrl);
  const res = await c.login(SEED.organizerA);
  assert.equal(res.location, '/organizer');
  const area = await c.get('/organizer');
  assert.equal(area.status, 200);
  assert.match(area.text, /Área do organizador/);
});

test('login respeita next apenas para caminho local', async () => {
  const c = createClient(app.baseUrl);
  const ok = await c.post('/login', { email: SEED.organizerA, password: SEED.password, next: '/organizer' });
  assert.equal(ok.location, '/organizer');
  const evil = await createClient(app.baseUrl).post('/login', { email: SEED.participant, password: SEED.password, next: '//evil.com' });
  assert.equal(evil.location, '/');
});

test('healthz responde ok', async () => {
  const res = await createClient(app.baseUrl).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});
