// F07: cancelamento de evento pelo serviço e pela página de gestão (R11, R05, R13), sem o worker do gateway: as
// respostas são entregues pelo teste (deliverResponses) ou seguradas (holdResponses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, useTestApp, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { getEvent, listOnSaleEvents } from '../../src/modules/events/service.js';
import { getAvailabilityMap, getSeatAvailability } from '../../src/modules/sales/service.js';
import { cancelEvent, MESSAGES } from '../../src/modules/cancellation/service.js';
import {
  CARD,
  HAS_CANCEL_BUTTON,
  activeTicketsOf,
  buy,
  buyPartner,
  buyStorefront,
  countRows,
  createEventVia,
  deliverResponses,
  eventInput,
  eventRow,
  holdResponses,
  loginAs,
  mainOf,
  myTicketRows,
  sectionKeys,
  sectionOf,
  serviceEvent,
  signupParticipant,
  statusesOf,
  ticketRow,
  ticketsOf,
} from './support.js';

const app = useTestApp({ workers: false });

const organizerA = () => app.users.organizerA;

test('F07-CA02 (R11, X15): cancelar evento publicado estorna confirmados e cancela pendentes da vitrine e do parceiro, sem tocar nos recusados', async () => {
  const participant = app.users.participant;
  const eventId = await serviceEvent(organizerA().id, { name: 'Conversão F07', capacity: '10' });
  const otherId = await serviceEvent(organizerA().id, { name: 'Outro evento F07', capacity: '10' });

  const buyAll = async (list) => Promise.all(list.map(async ([fn, card]) => (await fn(card)).ticket));
  const [sConfirmed, pConfirmed, sDeclined, pDeclined, sCheckedIn, sPending, pPending, sPendingDecline] = await buyAll([
    [(c) => buyStorefront(eventId, c, participant), CARD.approve],
    [(c) => buyPartner(eventId, c), CARD.approve],
    [(c) => buyStorefront(eventId, c, participant), CARD.decline],
    [(c) => buyPartner(eventId, c), CARD.decline],
    [(c) => buyStorefront(eventId, c, participant), CARD.approve],
    [(c) => buyStorefront(eventId, c, participant), CARD.approveSlow],
    [(c) => buyPartner(eventId, c), CARD.approveSlow],
    [(c) => buyStorefront(eventId, c, participant), CARD.declineSlow],
  ]);
  const [otherConfirmed, otherPending] = await buyAll([
    [(c) => buyPartner(otherId, c), CARD.approve],
    [(c) => buyPartner(otherId, c), CARD.approveSlow],
  ]);
  const pending = [sPending, pPending, sPendingDecline, otherPending].map((t) => t.id);
  await holdResponses(pending);
  await deliverResponses([sConfirmed, pConfirmed, sDeclined, pDeclined, sCheckedIn, otherConfirmed].map((t) => t.id));
  // Ingresso confirmado que já passou pelo check-in (F06 grava checked_in_at): também é estornado.
  await query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [sCheckedIn.id]);

  const declinedBefore = await ticketRow(sDeclined.id);
  const result = await cancelEvent(organizerA().id, eventId);
  assert.equal(result.event.status, 'cancelled');
  assert.ok(result.event.cancelledAt instanceof Date);
  assert.equal(result.refunded, 3);
  assert.equal(result.cancelled, 3);

  assert.deepEqual(await statusesOf(eventId), {
    [sConfirmed.id]: 'refunded',
    [pConfirmed.id]: 'refunded',
    [sCheckedIn.id]: 'refunded',
    [sPending.id]: 'cancelled',
    [pPending.id]: 'cancelled',
    [sPendingDecline.id]: 'cancelled',
    [sDeclined.id]: 'declined',
    [pDeclined.id]: 'declined',
  });
  assert.deepEqual(await ticketRow(sDeclined.id), declinedBefore, 'recusado fica intocado');
  assert.ok((await ticketRow(sCheckedIn.id)).checked_in_at, 'o check-in continua registrado');

  const row = await eventRow(eventId);
  assert.equal(row.status, 'cancelled');
  assert.ok(row.cancelled_at);
  // Outro evento do mesmo organizador não muda
  assert.equal((await eventRow(otherId)).status, 'published');
  assert.deepEqual(await statusesOf(otherId), { [otherConfirmed.id]: 'confirmed', [otherPending.id]: 'pending' });
});

test('F07-CA01 (R11): rascunho e evento já cancelado não são cancelados; o cancelamento é único', async () => {
  const draftId = await serviceEvent(organizerA().id, { name: 'Rascunho F07' }, { publish: false });
  const draft = await cancelEvent(organizerA().id, draftId);
  assert.deepEqual(draft.errors, [MESSAGES.onlyPublished]);
  assert.equal(draft.status, 409);
  assert.equal((await eventRow(draftId)).status, 'draft');
  assert.equal(MESSAGES.onlyPublished, 'Só eventos publicados podem ser cancelados.');

  const eventId = await serviceEvent(organizerA().id, { name: 'Cancela uma vez' });
  const { ticket } = await buyPartner(eventId, CARD.approveSlow);
  await holdResponses([ticket.id]);
  assert.equal((await cancelEvent(organizerA().id, eventId)).cancelled, 1);
  const eventAfter = await eventRow(eventId);
  const ticketAfter = await ticketRow(ticket.id);

  const again = await cancelEvent(organizerA().id, eventId);
  assert.deepEqual(again.errors, [MESSAGES.alreadyCancelled]);
  assert.equal(again.status, 409);
  assert.equal(MESSAGES.alreadyCancelled, 'Evento já está cancelado.');
  assert.deepEqual(await eventRow(eventId), eventAfter, 'cancelled_at não muda');
  assert.deepEqual(await ticketRow(ticket.id), ticketAfter, 'ingressos inalterados');

  // Outro organizador, inexistente ou id inválido: notFound, sem tocar em nada (R13)
  const publishedId = await serviceEvent(organizerA().id, { name: 'De A' });
  for (const [organizerId, id] of [
    [app.users.organizerB.id, publishedId],
    [organizerA().id, 'evt_inexistente'],
    [organizerA().id, ''],
    [organizerA().id, undefined],
    [null, publishedId],
  ]) {
    assert.deepEqual(await cancelEvent(organizerId, id), { notFound: true });
  }
  assert.equal((await eventRow(publishedId)).status, 'published');

  // Pela gestão (C08, C09)
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const res = await a.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(res.status, 409);
  assert.ok(res.text.includes('Evento já está cancelado.'));
  assert.deepEqual(await ticketRow(ticket.id), ticketAfter);

  const draftRes = await a.post(`/organizer/events/${draftId}/cancel`, {});
  assert.equal(draftRes.status, 409);
  assert.ok(sectionOf(draftRes.text, 'cancel').includes('Só eventos publicados podem ser cancelados.'));
  assert.equal((await eventRow(draftId)).status, 'draft');
});

test('evento cancelado tem 0 vagas disponíveis', async () => {
  const eventId = await serviceEvent(organizerA().id, { name: 'Vagas F07', capacity: '5' });
  const tickets = [];
  for (const card of [CARD.approve, CARD.approveSlow, CARD.decline]) tickets.push((await buyPartner(eventId, card)).ticket);
  await holdResponses([tickets[1].id]);
  await deliverResponses([tickets[0].id, tickets[2].id]);
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 5, occupied: 2, available: 3 });

  await cancelEvent(organizerA().id, eventId);
  // R05: em evento cancelado, vagas disponíveis = 0 (e nenhum ingresso ocupa vaga)
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 5, occupied: 0, available: 0 });
  assert.equal((await getAvailabilityMap([eventId])).get(eventId), 0);
  assert.deepEqual(await activeTicketsOf(eventId), []);
});

test('X14, X15 (R02, R11): evento cancelado sai da vitrine e de listOnSaleEvents e não vende mais, na vitrine nem no parceiro', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Vitrine F07', capacity: '5' });
  const participant = await signupParticipant(app.baseUrl, 'Rui');
  const visitor = createClient(app.baseUrl);
  assert.match((await visitor.get('/')).text, /Vitrine F07/);
  assert.equal((await participant.get(`/events/${eventId}`)).status, 200);
  assert.equal((await buy(participant, eventId, CARD.approveSlow)).status, 302);
  await holdResponses((await ticketsOf(eventId)).map((t) => t.id));

  assert.equal((await a.post(`/organizer/events/${eventId}/cancel`, {})).status, 200);
  const ticketsBefore = await countRows('tickets', 'event_id = $1', [eventId]);
  const chargesBefore = await countRows('gateway_charges');

  // Vitrine, página pública e listOnSaleEvents (fonte da listagem da API de parceiros, F05)
  assert.doesNotMatch((await visitor.get('/')).text, /Vitrine F07/);
  assert.equal((await visitor.get(`/events/${eventId}`)).status, 404);
  assert.doesNotMatch((await participant.get(`/events/${eventId}`)).text, /Vitrine F07/);
  assert.ok(!(await listOnSaleEvents()).some((e) => e.id === eventId));

  // Compra na vitrine → 404 sem dados; compra pelo serviço (vitrine e parceiro) → event_not_available
  const res = await buy(participant, eventId, CARD.approve);
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /Vitrine F07/);
  assert.deepEqual(await buyPartner(eventId, CARD.approve), { ok: false, error: 'event_not_available' });
  assert.deepEqual(await buyStorefront(eventId, CARD.approve, app.users.participant), {
    ok: false,
    error: 'event_not_available',
  });
  assert.equal(await countRows('tickets', 'event_id = $1', [eventId]), ticketsBefore);
  assert.equal(await countRows('gateway_charges'), chargesBefore, 'nenhuma cobrança nova');
});

test('X14 (R11): a gestão do evento cancelado não oferece edição nem cancelamento e recusa edição e republicação', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Gestão F07', capacity: '5' });
  assert.equal((await a.post(`/organizer/events/${eventId}/cancel`, {})).status, 200);
  const before = await eventRow(eventId);

  const page = await a.get(`/organizer/events/${eventId}`);
  assert.equal(page.status, 200);
  const main = mainOf(page.text);
  assert.doesNotMatch(main, /<form/, 'sem formulário de edição, publicação ou cancelamento');
  assert.doesNotMatch(main, /name="capacity"/);
  assert.doesNotMatch(main, /Cancelar evento/);
  assert.match(sectionOf(page.text, 'cancel'), /Evento cancelado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\./);

  const edit = await a.post(`/organizer/events/${eventId}`, eventInput({ name: 'Mudou F07', capacity: '9' }));
  assert.equal(edit.status, 409);
  assert.ok(edit.text.includes('Evento cancelado não pode ser editado.'));
  assert.doesNotMatch(mainOf(edit.text), /Cancelar evento/);

  const publish = await a.post(`/organizer/events/${eventId}/publish`, {});
  assert.equal(publish.status, 409);
  assert.ok(publish.text.includes('Evento cancelado não pode ser republicado.'));

  assert.deepEqual(await eventRow(eventId), before);
  assert.equal((await getEvent(eventId)).status, 'cancelled');
});

test('F07-CA01 (R04): a gestão do evento publicado tem a seção de cancelamento, com confirmação, depois da edição', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Seção F07' });

  const page = await a.get(`/organizer/events/${eventId}`);
  const keys = sectionKeys(page.text);
  assert.ok(keys.includes('cancel'));
  assert.ok(keys.indexOf('cancel') > keys.indexOf('edit'), 'ordem 90, depois da edição (50)');
  const section = sectionOf(page.text, 'cancel');
  assert.match(section, new RegExp(`<form method="post" action="/organizer/events/${eventId}/cancel"`));
  assert.match(section, HAS_CANCEL_BUTTON);
  assert.match(section, /onclick="return confirm\('[^']+'\)"/);
  assert.match(section, /irreversível/);

  // Rascunho: sem botão, com o aviso
  const draftId = await createEventVia(a, { name: 'Seção rascunho F07' }, { publish: false });
  const draftSection = sectionOf((await a.get(`/organizer/events/${draftId}`)).text, 'cancel');
  assert.doesNotMatch(draftSection, /<form/);
  assert.match(draftSection, /Só eventos publicados podem ser cancelados\./);
});

test('F07-CA01, F07-CA02: cancelar pela gestão responde 200 com "Evento cancelado" e "Meus ingressos" mostra estornado e cancelado', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Pela gestão F07', capacity: '5' });
  const participant = await signupParticipant(app.baseUrl, 'Sol');
  assert.equal((await buy(participant, eventId, CARD.approveSlow)).status, 302);
  assert.equal((await buy(participant, eventId, CARD.approve)).status, 302);
  const [slow, fast] = await ticketsOf(eventId);
  await holdResponses([slow.id]);
  await deliverResponses([fast.id]);
  assert.equal((await ticketRow(fast.id)).status, 'confirmed');

  const res = await a.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Evento cancelado. 1 ingresso estornado e 1 cancelado.'));
  assert.doesNotMatch(mainOf(res.text), /<form/, 'a resposta já vem sem edição nem botão de cancelar');
  assert.equal((await eventRow(eventId)).status, 'cancelled');
  assert.equal((await ticketRow(fast.id)).status, 'refunded');
  assert.equal((await ticketRow(slow.id)).status, 'cancelled');

  const rows = myTicketRows((await participant.get('/my-tickets')).text);
  const byId = Object.fromEntries(rows.map((r) => [r.ticketId, r]));
  assert.equal(byId[fast.id].label, 'estornado');
  assert.equal(byId[slow.id].label, 'cancelado');
  assert.equal(byId[fast.id].code, fast.code);
});

test('F07-CA06 (R13): só o organizador dono cancela; participante e visitante não acessam', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const p = await loginAs(app.baseUrl, SEED.participant);
  const visitor = createClient(app.baseUrl);
  const eventId = await createEventVia(a, { name: 'Segredo de A F07', venue: 'Porão de A' });

  const byB = await b.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(byB.status, 404);
  assert.doesNotMatch(byB.text, /Segredo de A|Porão de A/);
  assert.ok(!byB.text.includes(eventId));

  const byParticipant = await p.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(byParticipant.status, 403);
  assert.doesNotMatch(byParticipant.text, /Segredo de A/);

  const byVisitor = await visitor.post(`/organizer/events/${eventId}/cancel`, {});
  assert.equal(byVisitor.status, 302);
  assert.match(byVisitor.location, /^\/login\?next=/);

  assert.equal((await b.post('/organizer/events/evt_inexistente/cancel', {})).status, 404);
  assert.equal((await eventRow(eventId)).status, 'published');
  assert.equal((await a.post(`/organizer/events/${eventId}/cancel`, {})).status, 200, 'o dono cancela');
});
