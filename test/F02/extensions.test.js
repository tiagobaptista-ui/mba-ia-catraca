// Pontos de extensão de F02 vistos do lado de outra feature: um módulo falso (como F04/F06/F07/F08 farão)
// registra seções, extras, rotas com loadOwnedEvent e um capacity guard, e o app real é montado com ele.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, createClient, closeDb, SEED } from '../helpers/index.js';
import { loadModules } from '../../src/core/modules.js';
import { createApp } from '../../src/app.js';
import { html } from '../../src/core/html.js';
import { pool } from '../../src/core/db.js';
import { toDateTimeLocalValue } from '../../src/core/time.js';
import { updateEvent, getEvent, isOnSale } from '../../src/modules/events/service.js';
import {
  addManagementSection,
  removeManagementSection,
  addStorefrontExtra,
  loadOwnedEvent,
  renderManagementPage,
  renderEventPage,
  setCapacityGuard,
} from '../../src/modules/events/extensions.js';
import { eventInput, createEventVia, publishVia, eventRow, mainText, sectionKeys, sectionOf } from './support.js';

// Módulo de uma "outra feature": POSTs que devolvem o resultado na própria página (gestão e página pública).
const fakeFeature = {
  name: 'fake-feature',
  order: 30,
  register(app) {
    app.post('/organizer/events/:id/fake-checkin', loadOwnedEvent, async (req, res) => {
      const code = (req.body && req.body.code) || '';
      await renderManagementPage(req, res, req.event, {
        status: code ? 200 : 422,
        results: { 'fake-checkin': { message: code ? `Código ${code} recebido` : 'Informe o código' } },
      });
    });
    app.post('/events/:id/fake-buy', async (req, res) => {
      const event = await getEvent(req.params.id);
      if (!isOnSale(event)) return res.status(404).send('nao');
      return renderEventPage(req, res, event, { status: 409, results: { 'fake-buy': 'Ingressos esgotados' } });
    });
  },
};

const ctx = {};
before(async () => {
  ctx.users = await resetDb();
  const modules = await loadModules();
  const app = createApp([...modules, fakeFeature]);
  ctx.server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  ctx.baseUrl = `http://127.0.0.1:${ctx.server.address().port}`;
});
after(async () => {
  ctx.server.closeAllConnections();
  await new Promise((resolve) => ctx.server.close(resolve));
  await closeDb();
});

async function login(email) {
  const c = createClient(ctx.baseUrl);
  await c.login(email);
  return c;
}

test('F02-CA04 (R04): seções registradas por outras features aparecem na página de gestão', async () => {
  const renders = [];
  addManagementSection({
    key: 'fake-panel',
    order: 10,
    render: async ({ event, user }) => {
      renders.push({ event: event.id, user: user.email });
      return html`<h2>Painel falso</h2><p>Lotação ${event.capacity} de ${event.name}</p>`;
    },
  });
  addManagementSection({
    key: 'fake-checkin',
    order: 20,
    render: ({ event, result }) => html`<h2>Check-in falso</h2>
      ${result ? html`<p class="result">${result.message}</p>` : ''}
      <form method="post" action="/organizer/events/${event.id}/fake-checkin"><input name="code"></form>`,
  });
  addManagementSection({ key: 'fake-hidden', order: 30, render: () => null });
  addManagementSection({ key: 'fake-cancel', order: 90, render: () => html`<h2>Cancelar falso</h2>` });
  try {
    const a = await login(SEED.organizerA);
    const id = await createEventVia(a, { name: 'Seções', capacity: '4' });

    const page = await a.get(`/organizer/events/${id}`);
    assert.equal(page.status, 200);
    // nativas de F02 (0, 40, 50) intercaladas com as das outras features pela ordem
    // (as seções reais de outras features, como o painel de F08, ficam de fora da comparação)
    const ownKeys = (text) =>
      sectionKeys(text).filter((k) => k.startsWith('fake-') || ['details', 'publish', 'edit'].includes(k));
    assert.deepEqual(ownKeys(page.text), ['details', 'fake-panel', 'fake-checkin', 'publish', 'edit', 'fake-cancel']);
    assert.match(sectionOf(page.text, 'fake-panel'), /Lotação 4 de Seções/);
    assert.doesNotMatch(sectionOf(page.text, 'fake-checkin'), /class="result"/);
    assert.deepEqual(renders, [{ event: id, user: SEED.organizerA }]);

    // POST da outra feature devolve o resultado dentro da própria seção, com a página inteira
    const posted = await a.post(`/organizer/events/${id}/fake-checkin`, { code: 'ABC23456' });
    assert.equal(posted.status, 200);
    assert.match(sectionOf(posted.text, 'fake-checkin'), /<p class="result">Código ABC23456 recebido<\/p>/);
    assert.deepEqual(sectionKeys(posted.text), sectionKeys(page.text));
    const invalid = await a.post(`/organizer/events/${id}/fake-checkin`, {});
    assert.equal(invalid.status, 422);
    assert.match(sectionOf(invalid.text, 'fake-checkin'), /Informe o código/);

    // registrar de novo com a mesma key substitui a seção (sem duplicar)
    addManagementSection({ key: 'fake-panel', order: 10, render: () => html`<p>Painel v2</p>` });
    const again = await a.get(`/organizer/events/${id}`);
    assert.equal(sectionKeys(again.text).filter((k) => k === 'fake-panel').length, 1);
    assert.match(sectionOf(again.text, 'fake-panel'), /Painel v2/);
  } finally {
    for (const key of ['fake-panel', 'fake-checkin', 'fake-hidden', 'fake-cancel']) removeManagementSection(key);
  }
});

test('F02-CA06 (R13): sub-rotas de outras features com loadOwnedEvent respondem 404 a quem não é dono', async () => {
  const a = await login(SEED.organizerA);
  const id = await createEventVia(a, { name: 'Sub-rota de A', capacity: '13', price: '77,00' });

  const b = await login(SEED.organizerB);
  const res = await b.post(`/organizer/events/${id}/fake-checkin`, { code: 'X' });
  assert.equal(res.status, 404);
  assert.match(res.text, /Evento não encontrado/);
  assert.doesNotMatch(res.text, /Sub-rota de A|Porão|77,00/);
  assert.doesNotMatch(mainText(res.text), /\d/);

  const participant = await login(SEED.participant);
  assert.equal((await participant.post(`/organizer/events/${id}/fake-checkin`, { code: 'X' })).status, 403);
  const visitor = await createClient(ctx.baseUrl).post(`/organizer/events/${id}/fake-checkin`, { code: 'X' });
  assert.equal(visitor.status, 302);
  assert.match(visitor.location, /^\/login\?next=/);
});

test('extras da página pública recebem o resultado do POST de outra feature (renderEventPage)', async () => {
  addStorefrontExtra({
    key: 'fake-buy',
    order: 20,
    render: ({ variant, result }) => (variant === 'page' && result ? html`<p class="error">${result}</p>` : ''),
  });
  const a = await login(SEED.organizerA);
  const id = await createEventVia(a, { name: 'Compra falsa' });
  await publishVia(a, id);
  const res = await createClient(ctx.baseUrl).post(`/events/${id}/fake-buy`, {});
  assert.equal(res.status, 409);
  assert.match(res.text, /<h1>Compra falsa<\/h1>/);
  assert.match(res.text, /<div class="extra" data-extra="fake-buy"><p class="error">Ingressos esgotados<\/p><\/div>/);
  const plain = await createClient(ctx.baseUrl).get(`/events/${id}`);
  assert.doesNotMatch(plain.text, /data-extra="fake-buy"/);
});

test('F02-CA05 (R03): capacity guard rejeita a redução abaixo das vagas ocupadas e o aumento é aceito', async () => {
  const OCCUPIED = 3;
  const calls = [];
  // Guard falso, no lugar do de F04: acusa 3 vagas ocupadas. Confere que roda com a linha do evento travada.
  setCapacityGuard(async (client, event, newCapacity) => {
    const other = await pool.connect();
    let locked = false;
    try {
      await other.query('SELECT 1 FROM events WHERE id = $1 FOR UPDATE NOWAIT', [event.id]);
    } catch (err) {
      locked = err.code === '55P03'; // lock_not_available
    } finally {
      other.release();
    }
    await client.query('SELECT 1'); // o guard recebe o client da transação
    calls.push({ capacity: event.capacity, newCapacity, locked });
    return newCapacity < OCCUPIED ? `A lotação não pode ficar abaixo das ${OCCUPIED} vagas ocupadas.` : null;
  });
  try {
    const a = await login(SEED.organizerA);
    const id = await createEventVia(a, { name: 'Guard', capacity: '5' });
    await publishVia(a, id);
    // demais campos iguais aos gravados; só a lotação muda
    const startsAt = toDateTimeLocalValue((await eventRow(id)).starts_at);
    const form = (capacity) => eventInput({ name: 'Guard', capacity, startsAt });

    // redução abaixo das vagas ocupadas → rejeitada com a mensagem do guard, nada muda
    const rejected = await a.post(`/organizer/events/${id}`, form('2'));
    assert.equal(rejected.status, 409);
    assert.ok(rejected.text.includes('A lotação não pode ficar abaixo das 3 vagas ocupadas.'));
    assert.equal((await eventRow(id)).capacity, 5);
    assert.deepEqual(calls, [{ capacity: 5, newCapacity: 2, locked: true }]);

    // redução que o guard aceita
    const reduced = await a.post(`/organizer/events/${id}`, form('3'));
    assert.equal(reduced.status, 302);
    assert.equal((await eventRow(id)).capacity, 3);
    assert.equal(calls.length, 2);

    // aumento é aceito (não há como ficar abaixo das vagas ocupadas)
    const increased = await a.post(`/organizer/events/${id}`, form('10'));
    assert.equal(increased.status, 302);
    assert.equal((await eventRow(id)).capacity, 10);

    // mesma regra pelo serviço
    const viaService = await updateEvent(ctx.users.organizerA.id, id, form('1'));
    assert.equal(viaService.status, 409);
    assert.deepEqual(viaService.errors, ['A lotação não pode ficar abaixo das 3 vagas ocupadas.']);
    assert.equal((await eventRow(id)).capacity, 10);
  } finally {
    setCapacityGuard(null);
  }
});

test('F02-CA05 (R03): sem capacity guard registrado, a redução é aceita', async () => {
  const a = await login(SEED.organizerA);
  const id = await createEventVia(a, { name: 'Sem guard', capacity: '5' });
  const res = await a.post(`/organizer/events/${id}`, eventInput({ name: 'Sem guard', capacity: '1' }));
  assert.equal(res.status, 302);
  assert.equal((await eventRow(id)).capacity, 1);
});
