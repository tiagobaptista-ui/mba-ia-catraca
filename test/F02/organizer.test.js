import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED, localDateTimeInDays } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { formatDateTimeBR } from '../../src/core/time.js';
import { listOnSaleEvents, listOrganizerEvents, getEvent } from '../../src/modules/events/service.js';
import {
  eventInput,
  createEventVia,
  publishVia,
  eventRow,
  countEvents,
  mainOf,
  sectionKeys,
  sectionOf,
} from './support.js';

const app = useTestApp({ workers: false });

async function organizerA() {
  const c = createClient(app.baseUrl);
  await c.login(SEED.organizerA);
  return c;
}

test('F02-CA01 (R01, R02): organizador cria evento válido, que nasce rascunho e aparece na sua lista', async () => {
  const a = await organizerA();
  const form = await a.get('/organizer/events/new');
  assert.equal(form.status, 200);
  for (const label of ['Nome', 'Data e hora de início', 'Local', 'Lotação', 'Preço (R$)']) {
    assert.ok(form.text.includes(`>${label}</label>`), `campo ${label}`);
  }

  const res = await a.post('/organizer/events', eventInput({ name: 'Jazz CA01' }));
  assert.equal(res.status, 302);
  assert.match(res.location, /^\/organizer\/events\/evt_[a-z2-9]{10}$/);
  const id = res.location.split('/').pop();

  const row = await eventRow(id);
  assert.equal(row.status, 'draft');
  assert.equal(row.price_cents, 10000);
  assert.equal(row.capacity, 2);
  assert.equal(row.name, 'Jazz CA01');
  assert.equal(row.venue, 'Porão');
  assert.equal(row.organizer_id, app.users.organizerA.id);
  assert.equal(row.published_at, null);

  const list = await a.get('/organizer');
  assert.equal(list.status, 200);
  const rowHtml = new RegExp(`<tr data-event-id="${id}">([\\s\\S]*?)</tr>`).exec(list.text)[1];
  assert.match(rowHtml, /Jazz CA01/);
  assert.match(rowHtml, /Rascunho/);
  assert.match(rowHtml, new RegExp(`href="/organizer/events/${id}"`));
  assert.match(rowHtml, new RegExp(formatDateTimeBR(row.starts_at)));
  assert.ok((await listOrganizerEvents(app.users.organizerA.id)).some((e) => e.id === id));
});

test('F02-CA02 (R01): data no passado é rejeitada ao criar, sem criar evento', async () => {
  const a = await organizerA();
  const before = await countEvents();
  const res = await a.post('/organizer/events', eventInput({ name: 'Passado', startsAt: localDateTimeInDays(-1) }));
  assert.equal(res.status, 422);
  assert.ok(res.text.includes('A data de início precisa estar no futuro.'));
  assert.equal(await countEvents(), before);
  // o formulário volta preenchido com o que foi enviado
  assert.match(res.text, /name="name" value="Passado"/);
});

test('F02-CA02 (R01): data no passado é rejeitada ao editar e starts_at fica inalterado', async () => {
  const a = await organizerA();
  const id = await createEventVia(a, { name: 'Editar passado' });
  const before = await eventRow(id);
  const res = await a.post(
    `/organizer/events/${id}`,
    eventInput({ name: 'Editar passado', startsAt: localDateTimeInDays(-1) }),
  );
  assert.equal(res.status, 422);
  assert.ok(res.text.includes('A data de início precisa estar no futuro.'));
  const after = await eventRow(id);
  assert.equal(after.starts_at.getTime(), before.starts_at.getTime());
  assert.equal(after.updated_at.getTime(), before.updated_at.getTime());
});

test('F02-CA02: lotação < 1, preço ≤ 0 e campo faltando são rejeitados com mensagem, ao criar e ao editar', async () => {
  const a = await organizerA();
  const before = await countEvents();
  const cases = [
    [{ capacity: '0' }, 'A lotação precisa ser um número inteiro maior ou igual a 1.'],
    [{ price: '0' }, 'O preço precisa ser maior que zero.'],
    [{ price: '-5,00' }, 'O preço precisa ser maior que zero.'],
    [{ name: '' }, 'Informe o nome do evento.'],
    [{ venue: undefined }, 'Informe o local.'],
    [{ startsAt: undefined }, 'Informe a data e hora de início.'],
  ];
  const strip = (form) => Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
  for (const [overrides, message] of cases) {
    const res = await a.post('/organizer/events', strip(eventInput(overrides)));
    assert.equal(res.status, 422, JSON.stringify(overrides));
    assert.ok(res.text.includes(message), `${JSON.stringify(overrides)} → ${message}`);
  }
  assert.equal(await countEvents(), before);

  const id = await createEventVia(a, { name: 'Editar inválido' });
  const original = await eventRow(id);
  for (const [overrides, message] of cases) {
    const res = await a.post(`/organizer/events/${id}`, strip(eventInput({ name: 'Editar inválido', ...overrides })));
    assert.equal(res.status, 422, JSON.stringify(overrides));
    assert.ok(res.text.includes(message), `edição ${JSON.stringify(overrides)} → ${message}`);
  }
  assert.deepEqual(await eventRow(id), original);
});

test('F02-CA04 (R04): página de gestão com endereço próprio mostra dados, publicação e edição', async () => {
  const a = await organizerA();
  const id = await createEventVia(a, { name: 'Gestão CA04', capacity: '7', price: '35,50' });
  const res = await a.get(`/organizer/events/${id}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Gestão CA04<\/h1>/);
  assert.deepEqual(sectionKeys(res.text), ['details', 'publish', 'edit']);

  const details = sectionOf(res.text, 'details');
  assert.match(details, /Rascunho/);
  assert.match(details, /R\$ 35,50/);
  assert.match(details, /<dd>7<\/dd>/);
  assert.match(sectionOf(res.text, 'publish'), new RegExp(`action="/organizer/events/${id}/publish"`));
  const edit = sectionOf(res.text, 'edit');
  assert.match(edit, new RegExp(`<form method="post" action="/organizer/events/${id}"`));
  assert.match(edit, /name="price"[^>]*value="35,50"/);
  assert.match(edit, /name="capacity"[^>]*value="7"/);

  const missing = await a.get('/organizer/events/evt_naoexiste');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /Evento não encontrado/);
});

test('F02-CA05 (R03): edição válida grava, redireciona para a gestão com aviso e aceita aumentar a lotação', async () => {
  const a = await organizerA();
  const id = await createEventVia(a, { name: 'Editar CA05' });
  const newStart = localDateTimeInDays(45);
  const res = await a.post(
    `/organizer/events/${id}`,
    eventInput({ name: 'Editado CA05', startsAt: newStart, venue: 'Bar do Zé', capacity: '3', price: '120,00' }),
  );
  assert.equal(res.status, 302);
  assert.equal(res.location, `/organizer/events/${id}?aviso=atualizado`);
  const row = await eventRow(id);
  assert.equal(row.name, 'Editado CA05');
  assert.equal(row.venue, 'Bar do Zé');
  assert.equal(row.capacity, 3);
  assert.equal(row.price_cents, 12000);
  assert.equal(row.status, 'draft');

  const page = await a.get(res.location);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('Evento atualizado.'));
  assert.match(sectionOf(page.text, 'edit'), new RegExp(`name="startsAt"[^>]*value="${newStart}"`));

  // aviso desconhecido não é refletido na página
  const other = await a.get(`/organizer/events/${id}?aviso=constructor`);
  assert.doesNotMatch(other.text, /class="notice"/);
});

test('F02-CA03 (R02): publicar leva o rascunho a publicado; publicar de novo responde 409', async () => {
  const a = await organizerA();
  const id = await createEventVia(a, { name: 'Publicar CA03' });
  const res = await publishVia(a, id);
  assert.equal(res.location, `/organizer/events/${id}?aviso=publicado`);
  const row = await eventRow(id);
  assert.equal(row.status, 'published');
  assert.ok(row.published_at instanceof Date);

  const page = await a.get(res.location);
  assert.ok(page.text.includes('Evento publicado.'));
  assert.match(sectionOf(page.text, 'details'), /Publicado/);
  assert.doesNotMatch(sectionOf(page.text, 'publish'), /<form/);
  assert.ok((await listOnSaleEvents()).some((e) => e.id === id));

  const again = await a.post(`/organizer/events/${id}/publish`, {});
  assert.equal(again.status, 409);
  assert.ok(again.text.includes('Evento já está publicado.'));

  // evento publicado continua editável (sem sair da vitrine)
  const edit = await a.post(`/organizer/events/${id}`, eventInput({ name: 'Publicar CA03', price: '80,00' }));
  assert.equal(edit.status, 302);
  assert.equal((await getEvent(id)).status, 'published');
});

test('F02-CA07 (R11): evento cancelado não pode ser editado nem publicado e a gestão não oferece edição', async () => {
  const a = await organizerA();
  const id = await createEventVia(a, { name: 'Cancelado CA07' });
  await publishVia(a, id);
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
  const before = await eventRow(id);

  const edit = await a.post(`/organizer/events/${id}`, eventInput({ name: 'Mudou', capacity: '9' }));
  assert.equal(edit.status, 409);
  assert.ok(edit.text.includes('Evento cancelado não pode ser editado.'));

  const publish = await a.post(`/organizer/events/${id}/publish`, {});
  assert.equal(publish.status, 409);
  assert.ok(publish.text.includes('Evento cancelado não pode ser republicado.'));

  assert.deepEqual(await eventRow(id), before);

  const page = await a.get(`/organizer/events/${id}`);
  assert.equal(page.status, 200);
  assert.match(sectionOf(page.text, 'details'), /Cancelado/);
  assert.ok(page.text.includes('Evento cancelado: edição e publicação bloqueadas.'));
  assert.doesNotMatch(mainOf(page.text), /<form/);
  assert.doesNotMatch(page.text, /name="capacity"/);

  // fora da vitrine, da página pública e de listOnSaleEvents
  const visitor = createClient(app.baseUrl);
  assert.doesNotMatch((await visitor.get('/')).text, /Cancelado CA07/);
  assert.equal((await visitor.get(`/events/${id}`)).status, 404);
  assert.ok(!(await listOnSaleEvents()).some((e) => e.id === id));

  // rascunho cancelado também não é publicado
  const draftId = await createEventVia(a, { name: 'Rascunho cancelado' });
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [draftId]);
  const res = await a.post(`/organizer/events/${draftId}/publish`, {});
  assert.equal(res.status, 409);
  assert.equal((await eventRow(draftId)).status, 'cancelled');
});
