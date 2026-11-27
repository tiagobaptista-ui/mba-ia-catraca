// Check-in pela página de gestão (X12, X13), com o app completo e o worker do gateway ligado, como no produto:
// ingressos comprados na vitrine (POST /events/:id/purchase) e pelo canal parceiro, confirmados pelo worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, useTestApp, waitFor, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { listManagementSections } from '../../src/modules/events/extensions.js';
import {
  CARD,
  R10,
  buy,
  cancelLikeF07,
  checkinResultsOf,
  checkinVia,
  contractGrep,
  createEventVia,
  holdGatewayResponse,
  loginAs,
  mainText,
  sectionKeys,
  sectionOf,
  sell,
  signupParticipant,
  ticketRow,
} from './support.js';

const app = useTestApp({ workers: true });

async function waitStatus(ticketId, status) {
  await waitFor(async () => (await ticketRow(ticketId)).status === status, { timeoutMs: 5000, intervalMs: 20 });
}

// Compra na vitrine pelo participante; devolve a linha do ingresso recém-criado.
async function buyOnStorefront(participant, eventId, card) {
  const res = await buy(participant, eventId, card);
  assert.equal(res.status, 302, res.text);
  const { rows } = await query(
    "SELECT t.* FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.event_id = $1 AND u.email = $2 ORDER BY t.created_at DESC LIMIT 1",
    [eventId, participant.email],
  );
  return rows[0];
}

const checkinForm = (eventId) =>
  new RegExp(`<form method="post" action="/organizer/events/${eventId}/checkin" class="checkin-form">`);

test('X12 (R04): a página de gestão de evento publicado tem a seção de check-in com o campo code', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Gestão com check-in' });
  const page = await a.get(`/organizer/events/${eventId}`);
  assert.equal(page.status, 200);

  const keys = sectionKeys(page.text);
  assert.ok(keys.includes('checkin'), keys.join(','));
  assert.ok(keys.indexOf('details') < keys.indexOf('checkin') && keys.indexOf('checkin') < keys.indexOf('publish'));
  assert.deepEqual(listManagementSections().find((s) => s.key === 'checkin'), { key: 'checkin', order: 20 });

  const section = sectionOf(page.text, 'checkin');
  assert.match(section, /<h2>Check-in<\/h2>/);
  assert.match(section, checkinForm(eventId));
  assert.match(section, /<label for="checkin-code">Código do ingresso<\/label>/);
  assert.match(section, /<input id="checkin-code" name="code"/);
  assert.match(section, /<button type="submit">Validar entrada<\/button>/);
  assert.doesNotMatch(section, /checkin-result|Evento cancelado/, 'sem tentativa, sem resultado');
});

test('rascunho (nunca vendeu) não mostra a seção; um POST nele responde inválido na própria seção', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const draftId = await createEventVia(a, { name: 'Rascunho sem porta' }, { publish: false });
  const page = await a.get(`/organizer/events/${draftId}`);
  assert.equal(page.status, 200);
  assert.deepEqual(sectionKeys(page.text).filter((k) => k !== 'dashboard' && k !== 'cancel'), ['details', 'publish', 'edit']);

  const posted = await checkinVia(a, draftId, 'ZZZZZZZZ');
  assert.equal(posted.status, 200);
  assert.deepEqual(posted.result, { key: 'invalid', message: R10.invalid });
  assert.match(sectionOf(posted.text, 'checkin'), checkinForm(draftId));
});

test('X12, X13 (R10): fluxo do contrato pela gestão — liberada, já utilizado, normalizado, não confirmado, inválido', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const p = await signupParticipant(app.baseUrl, 'Participante F06');
  const e1 = await createEventVia(a, { name: 'E1 F06', capacity: '4' });
  const eb = await createEventVia(b, { name: 'EB F06', capacity: '2' });

  const c1 = await buyOnStorefront(p, e1, CARD.approve);
  const c2 = await buyOnStorefront(p, e1, CARD.declineSlow);
  await holdGatewayResponse([c2.id]); // fica pendente enquanto o teste roda
  const c3 = await buyOnStorefront(p, eb, CARD.approve);
  const c4 = await buyOnStorefront(p, e1, CARD.decline);
  await waitStatus(c1.id, 'confirmed');
  await waitStatus(c3.id, 'confirmed');
  await waitStatus(c4.id, 'declined');

  // C02: entrada liberada (200, página de gestão inteira, resultado e código informado na seção)
  const released = await checkinVia(a, e1, c1.code);
  assert.equal(released.status, 200);
  assert.match(released.text, /<h1>E1 F06<\/h1>/);
  assert.deepEqual(released.result, { key: 'released', message: R10.released });
  assert.deepEqual(contractGrep(released.text), ['data-result="released">Entrada liberada']);
  const section = sectionOf(released.text, 'checkin');
  assert.match(section, /<p class="checkin-result" data-result="released">Entrada liberada<\/p>/);
  assert.match(section, new RegExp(`<code class="checkin-code">${c1.code}</code>`));
  assert.match(section, checkinForm(e1), 'o campo continua lá para o próximo código');
  assert.ok((await ticketRow(c1.id)).checked_in_at instanceof Date);

  // C03 e C08: de novo, e em minúsculas com espaços
  assert.deepEqual(contractGrep((await checkinVia(a, e1, c1.code)).text), ['data-result="already_used">Ingresso já utilizado']);
  const normalized = await checkinVia(a, e1, ` ${c1.code.toLowerCase()} `);
  assert.deepEqual(normalized.result, { key: 'already_used', message: R10.already_used });
  assert.match(sectionOf(normalized.text, 'checkin'), new RegExp(`<code class="checkin-code">${c1.code}</code>`));

  // C04 e C05: pendente e recusado
  assert.equal((await ticketRow(c2.id)).status, 'pending');
  assert.deepEqual((await checkinVia(a, e1, c2.code)).result, { key: 'not_confirmed', message: R10.not_confirmed });
  assert.deepEqual((await checkinVia(a, e1, c4.code)).result, { key: 'not_confirmed', message: R10.not_confirmed });

  // C06 e C07: inexistente, vazio e de outro evento (de outro organizador)
  assert.deepEqual((await checkinVia(a, e1, 'ZZZZZZZZ')).result, { key: 'invalid', message: R10.invalid });
  assert.deepEqual((await checkinVia(a, e1, '')).result, { key: 'invalid', message: R10.invalid });
  assert.deepEqual((await checkinVia(a, e1)).result, { key: 'invalid', message: R10.invalid });
  assert.deepEqual((await checkinVia(a, e1, c3.code)).result, { key: 'invalid', message: R10.invalid });
  assert.equal((await ticketRow(c3.id)).checked_in_at, null);

  // o ingresso de EB continua valendo na gestão de EB (pelo dono dele)
  assert.deepEqual((await checkinVia(b, eb, c3.code)).result, { key: 'released', message: R10.released });
});

test('X13: ingresso do canal parceiro confirmado pelo worker libera a entrada pela gestão', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Parceiro na porta', capacity: '3' });
  const approved = await sell(eventId, { card: CARD.approve, channel: 'partner' });
  const declined = await sell(eventId, { card: CARD.decline, channel: 'partner' });
  await waitStatus(approved.id, 'confirmed');
  await waitStatus(declined.id, 'declined');

  assert.deepEqual((await checkinVia(a, eventId, approved.code.toLowerCase())).result, { key: 'released', message: R10.released });
  assert.deepEqual((await checkinVia(a, eventId, approved.code)).result, { key: 'already_used', message: R10.already_used });
  assert.deepEqual((await checkinVia(a, eventId, declined.code)).result, { key: 'not_confirmed', message: R10.not_confirmed });
});

test('X12 (R10): evento cancelado mantém o campo com a nota "Evento cancelado" e a ordem das regras vale', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const p = await signupParticipant(app.baseUrl, 'Participante cancelado');
  const e1 = await createEventVia(a, { name: 'E1 ordem', capacity: '2' });
  const e2 = await createEventVia(a, { name: 'E2 cancelado', capacity: '2' });
  const eb = await createEventVia(b, { name: 'EB ordem', capacity: '2' });
  const c1 = await buyOnStorefront(p, e1, CARD.approve);
  const c3 = await buyOnStorefront(p, eb, CARD.approve);
  const c5 = await buyOnStorefront(p, e2, CARD.approve);
  await Promise.all([waitStatus(c1.id, 'confirmed'), waitStatus(c3.id, 'confirmed'), waitStatus(c5.id, 'confirmed')]);
  await cancelLikeF07(e2);
  assert.equal((await ticketRow(c5.id)).status, 'refunded');

  const page = await a.get(`/organizer/events/${e2}`);
  assert.equal(page.status, 200);
  const section = sectionOf(page.text, 'checkin');
  assert.match(section, /<p class="checkin-note" data-event-status="cancelled">Evento cancelado<\/p>/);
  assert.match(section, checkinForm(e2), 'o campo continua disponível');

  // C09: estornado em evento cancelado → Evento cancelado; C10: de outro evento → inválido (1 vem antes de 2)
  assert.deepEqual(contractGrep((await checkinVia(a, e2, c5.code)).text), ['data-result="event_cancelled">Evento cancelado']);
  assert.deepEqual(contractGrep((await checkinVia(a, e2, c3.code)).text), ['data-result="invalid">Ingresso inválido para este evento']);
  assert.deepEqual(contractGrep((await checkinVia(a, e2, c1.code)).text), ['data-result="invalid">Ingresso inválido para este evento']);
  for (const id of [c1.id, c3.id, c5.id]) assert.equal((await ticketRow(id)).checked_in_at, null);
});

test('F06-CA07 (R13): organizador B recebe 404 sem dados de A e o check-in não acontece', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const eventId = await createEventVia(a, { name: 'Segredo de A', venue: 'Porão de A', capacity: '2', price: '87,00' });
  const ticket = await sell(eventId, { card: CARD.approve, channel: 'partner' });
  await waitStatus(ticket.id, 'confirmed');

  const responses = [
    await b.get(`/organizer/events/${eventId}`),
    await b.post(`/organizer/events/${eventId}/checkin`, { code: ticket.code }),
    await b.post(`/organizer/events/${eventId}/checkin`, { code: ticket.code.toLowerCase() }),
    await b.post('/organizer/events/evt_naoexiste/checkin', { code: ticket.code }),
  ];
  for (const res of responses) {
    assert.equal(res.status, 404);
    assert.match(res.text, /Evento não encontrado/);
    assert.doesNotMatch(res.text, /Segredo de A|Porão de A|87,00|checkin-result|data-result/);
    assert.ok(!res.text.includes(ticket.code), 'nem o código volta na resposta');
    assert.doesNotMatch(mainText(res.text), /\d/);
  }
  assert.equal((await ticketRow(ticket.id)).checked_in_at, null, 'checked_in_at inalterado');

  // o dono ainda faz o check-in normalmente
  assert.deepEqual((await checkinVia(a, eventId, ticket.code)).result, { key: 'released', message: R10.released });
});

test('F06-CA07 (R13): participante recebe 403 e visitante vai para o login, sem check-in', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Porta fechada', capacity: '2' });
  const ticket = await sell(eventId, { card: CARD.approve, channel: 'partner' });
  await waitStatus(ticket.id, 'confirmed');

  const participant = await loginAs(app.baseUrl, SEED.participant);
  const denied = await participant.post(`/organizer/events/${eventId}/checkin`, { code: ticket.code });
  assert.equal(denied.status, 403);
  assert.doesNotMatch(denied.text, /Porta fechada|data-result/);

  const visitor = await createClient(app.baseUrl).post(`/organizer/events/${eventId}/checkin`, { code: ticket.code });
  assert.equal(visitor.status, 302);
  assert.equal(visitor.location, `/login?next=${encodeURIComponent(`/organizer/events/${eventId}/checkin`)}`);

  assert.equal((await ticketRow(ticket.id)).checked_in_at, null);
});

test('o código informado volta escapado (sem injeção de HTML)', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Escape', capacity: '1' });
  const res = await checkinVia(a, eventId, '<script>alert(1)</script>');
  assert.equal(res.status, 200);
  assert.deepEqual(res.result, { key: 'invalid', message: R10.invalid });
  assert.doesNotMatch(res.text, /<script>/i);
  assert.match(sectionOf(res.text, 'checkin'), /&lt;SCRIPT&gt;ALERT\(1\)&lt;\/SCRIPT&gt;/);
  assert.equal(checkinResultsOf(res.text).length, 1);
});
