import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED, localDateTimeInDays } from '../helpers/index.js';
import { listOnSaleEvents, isOnSale, getEvent } from '../../src/modules/events/service.js';
import { addStorefrontExtra, removeStorefrontExtra } from '../../src/modules/events/extensions.js';
import { createEventVia, publishVia, eventRow, mainOf } from './support.js';

const app = useTestApp({ workers: false });

async function loggedIn(email = SEED.organizerA) {
  const c = createClient(app.baseUrl);
  await c.login(email);
  return c;
}

test('F02-CA03 (R02): rascunho fica fora da vitrine, de listOnSaleEvents e da página pública (404)', async () => {
  const a = await loggedIn();
  const id = await createEventVia(a, { name: 'Rascunho Vitrine' });
  const visitor = createClient(app.baseUrl);

  const home = await visitor.get('/');
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, /Rascunho Vitrine/);
  assert.ok(!(await listOnSaleEvents()).some((e) => e.id === id));
  assert.equal(isOnSale(await getEvent(id)), false);

  const page = await visitor.get(`/events/${id}`);
  assert.equal(page.status, 404);
  assert.match(page.text, /Evento não encontrado/);
  assert.doesNotMatch(page.text, /Rascunho Vitrine/);

  // nem o dono vê a página pública de um rascunho
  assert.equal((await a.get(`/events/${id}`)).status, 404);
});

test('F02-CA03 (R02): depois de publicado, aparece na vitrine com data dd/mm/aaaa hh:mm e preço, e a página pública responde 200', async () => {
  const a = await loggedIn();
  const id = await createEventVia(a, {
    name: 'Jazz Publicado',
    startsAt: '2027-01-15T21:30',
    venue: 'Porão',
    price: '1.234,50',
  });
  await publishVia(a, id);
  assert.ok((await listOnSaleEvents()).some((e) => e.id === id));

  const visitor = createClient(app.baseUrl);
  const home = await visitor.get('/');
  const card = new RegExp(`<article class="card" data-event-id="${id}">([\\s\\S]*?)</article>`).exec(home.text);
  assert.ok(card, 'card do evento na vitrine');
  assert.match(card[1], new RegExp(`<a href="/events/${id}">Jazz Publicado</a>`));
  assert.match(card[1], /15\/01\/2027 21:30/);
  assert.match(card[1], /Porão/);
  assert.match(card[1], /R\$ 1\.234,50/);

  const page = await visitor.get(`/events/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Jazz Publicado<\/h1>/);
  assert.match(page.text, /15\/01\/2027 21:30/);
  assert.match(page.text, /R\$ 1\.234,50/);

  // participante logado também vê
  const p = await loggedIn(SEED.participant);
  assert.match((await p.get('/')).text, /Jazz Publicado/);
});

test('vitrine ordena por data de início e escapa o HTML do nome', async () => {
  const a = await loggedIn();
  const later = await createEventVia(a, { name: 'Ordem B', startsAt: localDateTimeInDays(60) });
  const sooner = await createEventVia(a, { name: 'Ordem A <b>&</b>', startsAt: localDateTimeInDays(10) });
  await publishVia(a, later);
  await publishVia(a, sooner);
  const text = mainOf((await createClient(app.baseUrl).get('/')).text);
  assert.ok(text.indexOf(sooner) < text.indexOf(later));
  assert.match(text, /Ordem A &lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.doesNotMatch(text, /<b>&<\/b>/);
});

test('extras da vitrine (addStorefrontExtra) aparecem no card e na página pública, com a variante certa', async () => {
  const a = await loggedIn();
  const id = await createEventVia(a, { name: 'Com extras' });
  await publishVia(a, id);
  const seen = [];
  addStorefrontExtra({
    key: 'f02-teste',
    order: 10,
    render: async ({ event, variant, user }) => {
      seen.push({ id: event.id, variant, user: user ? user.email : null });
      return `extra ${variant} de ${event.name}`;
    },
  });
  addStorefrontExtra({ key: 'f02-vazio', render: () => null });
  try {
    const visitor = createClient(app.baseUrl);
    const home = await visitor.get('/');
    assert.match(home.text, /<div class="extra" data-extra="f02-teste">extra card de Com extras<\/div>/);
    assert.doesNotMatch(home.text, /data-extra="f02-vazio"/);

    const page = await visitor.get(`/events/${id}`);
    assert.match(page.text, /<div class="extra" data-extra="f02-teste">extra page de Com extras<\/div>/);
    assert.deepEqual(
      seen.filter((s) => s.id === id),
      [
        { id, variant: 'card', user: null },
        { id, variant: 'page', user: null },
      ],
    );
  } finally {
    removeStorefrontExtra('f02-teste');
    removeStorefrontExtra('f02-vazio');
  }
  assert.doesNotMatch((await createClient(app.baseUrl).get('/')).text, /data-extra="f02-teste"/);
});

test('página pública de evento inexistente responde 404', async () => {
  const res = await createClient(app.baseUrl).get('/events/evt_inexistente');
  assert.equal(res.status, 404);
  assert.match(res.text, /Evento não encontrado/);
  assert.equal(await eventRow('evt_inexistente'), null);
});
