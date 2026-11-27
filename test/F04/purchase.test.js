// Compra pela vitrine, sem o worker do gateway: as respostas são entregues pelo teste (deliverResponses), então
// cada estado intermediário (pendente, esgotado, recusado) é observado de forma determinística.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { useTestApp, createClient, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { config } from '../../src/core/config.js';
import { formatDateTimeBR } from '../../src/core/time.js';
import { getSeatAvailability, purchaseTicket } from '../../src/modules/sales/service.js';
import {
  CARD,
  HAS_PURCHASE_FORM,
  buy,
  cardOf,
  countRows,
  createEventVia,
  deliverResponses,
  loginAs,
  mainOf,
  myTicketRows,
  salesExtraOf,
  signupParticipant,
  ticketsOf,
} from './support.js';

const app = useTestApp({ workers: false });

async function eventStartsAt(id) {
  const { rows } = await query('SELECT starts_at FROM events WHERE id = $1', [id]);
  return rows[0].starts_at;
}

test('X03, F04-CA01 (R06, R08, R09): participante do /signup compra na página do evento; nasce pendente sem esperar o gateway e a aprovação confirma', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Jazz C01', capacity: '2', price: '100,00' });
  const p1 = await signupParticipant(app.baseUrl, 'Ana C01');

  // X04: publicado na gestão → página com formulário de compra
  const page = await p1.get(`/events/${eventId}`);
  assert.equal(page.status, 200);
  const extra = salesExtraOf(page.text);
  assert.ok(extra, 'extra de vendas na página do evento');
  assert.match(extra, HAS_PURCHASE_FORM);
  assert.match(extra, /<label for="cardNumber">Número do cartão \(16 dígitos\)<\/label>/);
  assert.match(extra, /name="cardNumber"/);
  assert.match(extra, /<button type="submit">Comprar ingresso<\/button>/);
  assert.match(extra, /2 vagas disponíveis/);

  // Escala real do gateway (1): a aprovação do 0001 está a ≥ 2 s, e a compra volta bem antes (R06).
  const saved = config.gatewayTimeScale;
  config.gatewayTimeScale = 1;
  let res;
  let elapsed;
  try {
    const started = performance.now();
    res = await buy(p1, eventId, CARD.approve);
    elapsed = performance.now() - started;
  } finally {
    config.gatewayTimeScale = saved;
  }
  assert.equal(res.status, 302);
  assert.equal(res.location, '/my-tickets');
  assert.ok(elapsed < 1000, `a compra levou ${elapsed.toFixed(0)} ms`);

  const [ticket] = await ticketsOf(eventId);
  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.channel, 'storefront');
  assert.equal(ticket.buyer_email, p1.email);
  assert.equal(ticket.price_cents, 10000);
  assert.equal(ticket.checked_in_at, null);
  const { rows: charges } = await query('SELECT * FROM gateway_charges WHERE ticket_id = $1', [ticket.id]);
  assert.equal(charges.length, 1, 'uma cobrança por compra, na mesma transação');
  assert.equal(charges[0].amount_cents, 10000);
  assert.equal(charges[0].card_last4, '0001');
  assert.equal(charges[0].responded_at, null);
  assert.ok(charges[0].respond_at.getTime() - Date.now() > 1500, 'resposta do gateway ainda no futuro');

  // "Meus ingressos": aviso da compra (uma vez só) e a linha pendente com evento, data, rótulo, código e valor
  const mine = await p1.get('/my-tickets');
  assert.equal(mine.status, 200);
  assert.match(mainOf(mine.text), /<h1>Meus ingressos<\/h1>/);
  assert.match(mine.text, /Compra registrada: ingresso pendente, aguardando o pagamento\./);
  const rows = myTicketRows(mine.text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    ticketId: ticket.id,
    eventId,
    event: 'Jazz C01',
    date: formatDateTimeBR(await eventStartsAt(eventId)),
    label: 'pendente',
    status: 'pending',
    code: ticket.code,
    price: 'R$ 100,00',
  });
  assert.match(rows[0].code, /^[A-HJ-NP-Z2-9]{8}$/);
  for (const header of ['Evento', 'Data', 'Status', 'Código', 'Valor pago']) {
    assert.ok(mine.text.includes(`<th>${header}</th>`), `coluna ${header}`);
  }
  const reloaded = await p1.get('/my-tickets');
  assert.doesNotMatch(reloaded.text, /Compra registrada/, 'o aviso aparece só depois da compra');

  // O gateway aprova → confirmado, mesmo código (R08)
  await deliverResponses([ticket.id]);
  const after = myTicketRows((await p1.get('/my-tickets')).text);
  assert.equal(after[0].label, 'confirmado');
  assert.equal(after[0].status, 'confirmed');
  assert.equal(after[0].code, ticket.code);
});

test('R09: "Meus ingressos" só mostra os ingressos do próprio participante', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Isolamento C04', capacity: '5' });
  const p1 = await signupParticipant(app.baseUrl, 'Bia');
  const p2 = await signupParticipant(app.baseUrl, 'Caio');

  assert.equal((await buy(p1, eventId, CARD.approveSlow)).status, 302);
  assert.equal((await buy(p1, eventId, CARD.approve)).status, 302);
  const [first, second] = await ticketsOf(eventId);

  const mine = myTicketRows((await p1.get('/my-tickets')).text);
  assert.deepEqual(mine.map((r) => r.code).sort(), [first.code, second.code].sort());

  const other = await p2.get('/my-tickets');
  assert.equal(other.status, 200);
  assert.deepEqual(myTicketRows(other.text), []);
  assert.doesNotMatch(other.text, new RegExp(`${first.code}|${second.code}|Isolamento C04`));
  assert.match(other.text, /Você ainda não comprou ingressos\./);

  assert.equal((await buy(p2, eventId, CARD.approve)).status, 302);
  const p2Rows = myTicketRows((await p2.get('/my-tickets')).text);
  assert.equal(p2Rows.length, 1);
  assert.ok(![first.code, second.code].includes(p2Rows[0].code));
});

test('F04-CA02, F04-CA03 (R05, R07, R08): pendente ocupa vaga e esgota; tentativa sem vaga é recusada; recusa libera a vaga', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Lotação Um', capacity: '1' });
  const p1 = await signupParticipant(app.baseUrl, 'Duda');
  const p2 = await signupParticipant(app.baseUrl, 'Edu');
  const visitor = createClient(app.baseUrl);

  assert.match(cardOf((await visitor.get('/')).text, eventId), /1 vaga disponível/);

  // Compra pendente (recusa lenta, 0004) já ocupa a única vaga (R05, R06)
  assert.equal((await buy(p1, eventId, CARD.declineSlow)).status, 302);
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 1, occupied: 1, available: 0 });

  for (const viewer of [p2, visitor, p1]) {
    const page = await viewer.get(`/events/${eventId}`);
    assert.equal(page.status, 200);
    const extra = salesExtraOf(page.text);
    assert.match(extra, /Ingressos esgotados/);
    assert.doesNotMatch(extra, HAS_PURCHASE_FORM, 'sem formulário quando esgotado');
    assert.doesNotMatch(extra, /Entre como participante/);
  }
  const card = cardOf((await p2.get('/')).text, eventId);
  assert.match(card, /Ingressos esgotados/);
  assert.doesNotMatch(card, /vagas? disponíve/);

  // Tentativa sem vaga: 409 com "Ingressos esgotados", sem criar ingresso nem cobrança (R07)
  const refused = await buy(p2, eventId, CARD.approve);
  assert.equal(refused.status, 409);
  assert.match(salesExtraOf(refused.text), /Ingressos esgotados/);
  assert.doesNotMatch(refused.text, HAS_PURCHASE_FORM);
  assert.match(refused.text, /<h1>Lotação Um<\/h1>/);
  const tickets = await ticketsOf(eventId);
  assert.equal(tickets.length, 1);
  assert.equal(await countRows('gateway_charges', 'ticket_id = ANY($1::text[])', [tickets.map((t) => t.id)]), 1);
  assert.equal(await countRows('gateway_charges'), await countRows('tickets'), 'uma cobrança por ingresso, nenhuma a mais');

  // Recusa do gateway → recusado e a vaga volta (R08, R05)
  await deliverResponses([tickets[0].id]);
  const p1Rows = myTicketRows((await p1.get('/my-tickets')).text);
  assert.equal(p1Rows[0].label, 'recusado');
  assert.deepEqual(await getSeatAvailability(eventId), { capacity: 1, occupied: 0, available: 1 });
  const reopened = salesExtraOf((await p2.get(`/events/${eventId}`)).text);
  assert.match(reopened, HAS_PURCHASE_FORM);
  assert.match(reopened, /1 vaga disponível/);
  assert.doesNotMatch(reopened, /Ingressos esgotados/);

  // Recusa rápida (0002): ocupa enquanto pendente, recusada libera de novo
  assert.equal((await buy(p2, eventId, CARD.decline)).status, 302);
  assert.equal((await getSeatAvailability(eventId)).available, 0);
  const p2Ticket = (await ticketsOf(eventId)).at(-1);
  await deliverResponses([p2Ticket.id]);
  assert.equal(myTicketRows((await p2.get('/my-tickets')).text)[0].label, 'recusado');
  assert.equal((await getSeatAvailability(eventId)).available, 1);
  assert.match(cardOf((await visitor.get('/')).text, eventId), /1 vaga disponível/);
});

test('F04-CA07 (R06): cartão sem 16 dígitos é rejeitado antes de criar o ingresso', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Cartão C09', capacity: '3' });
  const p1 = await signupParticipant(app.baseUrl, 'Fabi');
  const ticketsBefore = await countRows('tickets');
  const chargesBefore = await countRows('gateway_charges');

  const invalid = ['123', '400000000000001', '40000000000000001', '4000 0000 0000 0001', '400000000000000a', '', undefined];
  for (const card of invalid) {
    const res = await buy(p1, eventId, card);
    assert.equal(res.status, 422, `cartão ${JSON.stringify(card)}`);
    const extra = salesExtraOf(res.text);
    assert.match(extra, /<p class="error" role="alert">Número do cartão deve ter 16 dígitos\.<\/p>/);
    assert.match(extra, HAS_PURCHASE_FORM, 'o formulário continua disponível');
    assert.doesNotMatch(extra, /name="cardNumber"[^>]*value=/, 'o número digitado não é devolvido na página');
  }
  assert.equal(await countRows('tickets'), ticketsBefore);
  assert.equal(await countRows('gateway_charges'), chargesBefore);
  assert.equal((await getSeatAvailability(eventId)).available, 3);

  // Mesma regra no serviço (usado também pela API de parceiros)
  const viaService = await purchaseTicket({ eventId, cardNumber: '123', buyerEmail: 'x@teste.dev', channel: 'partner' });
  assert.deepEqual(viaService, { ok: false, error: 'invalid_card' });
  assert.deepEqual(
    await purchaseTicket({ eventId, cardNumber: 4000000000000001, buyerEmail: 'x@teste.dev', channel: 'partner' }),
    { ok: false, error: 'invalid_card' },
  );
  assert.equal(await countRows('tickets'), ticketsBefore);

  // Espaços nas pontas do campo do formulário são ignorados
  assert.equal((await buy(p1, eventId, ` ${CARD.approve} `)).status, 302);
  assert.equal(await countRows('tickets'), ticketsBefore + 1);
});

test('F04-CA08, X03: visitante que tenta comprar vai ao login com retorno à página do evento; organizador não compra', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Acesso C10', capacity: '3' });
  const visitor = createClient(app.baseUrl);

  const page = salesExtraOf((await visitor.get(`/events/${eventId}`)).text);
  assert.match(page, new RegExp(`<a href="/login\\?next=/events/${eventId}">Entre como participante para comprar</a>`));
  assert.doesNotMatch(page, HAS_PURCHASE_FORM);

  const res = await buy(visitor, eventId, CARD.approve);
  assert.equal(res.status, 302);
  assert.equal(res.location, `/login?next=/events/${eventId}`);
  const loginPage = await visitor.get(res.location);
  assert.match(loginPage.text, new RegExp(`<input type="hidden" name="next" value="/events/${eventId}">`));
  const login = await visitor.post('/login', { email: SEED.participant, password: SEED.password, next: `/events/${eventId}` });
  assert.equal(login.status, 302);
  assert.equal(login.location, `/events/${eventId}`);
  assert.match(salesExtraOf((await visitor.get(`/events/${eventId}`)).text), HAS_PURCHASE_FORM);

  const organizerPage = salesExtraOf((await a.get(`/events/${eventId}`)).text);
  assert.match(organizerPage, /Organizadores não compram ingressos\./);
  assert.doesNotMatch(organizerPage, HAS_PURCHASE_FORM);
  const forbidden = await buy(a, eventId, CARD.approve);
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.text, /Organizadores não compram ingressos\./);

  assert.equal((await ticketsOf(eventId)).length, 0);

  // "Meus ingressos" é só de participante
  const anonymous = await createClient(app.baseUrl).get('/my-tickets');
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.location, /^\/login\?next=/);
  assert.equal((await a.get('/my-tickets')).status, 403);
});

test('X04 (R02): rascunho não aceita compra; evento inexistente ou cancelado também não', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const draftId = await createEventVia(a, { name: 'Rascunho C11' }, { publish: false });
  const cancelledId = await createEventVia(a, { name: 'Cancelado F04', capacity: '4' });
  await query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelledId]);
  const p1 = await signupParticipant(app.baseUrl, 'Gabi');

  for (const id of [draftId, cancelledId, 'evt_inexistente']) {
    const res = await buy(p1, id, CARD.approve);
    assert.equal(res.status, 404, id);
    assert.match(res.text, /Evento não encontrado/);
    assert.doesNotMatch(res.text, /Rascunho C11|Cancelado F04/);
    const viaService = await purchaseTicket({ eventId: id, cardNumber: CARD.approve, buyerEmail: 'p@teste.dev', channel: 'partner' });
    assert.deepEqual(viaService, { ok: false, error: 'event_not_available' }, id);
  }
  assert.equal((await ticketsOf(draftId)).length, 0);
  assert.equal((await ticketsOf(cancelledId)).length, 0);

  // R05: cancelado tem 0 vagas disponíveis; rascunho não está à venda, mas a conta de vagas é a mesma
  assert.deepEqual(await getSeatAvailability(cancelledId), { capacity: 4, occupied: 0, available: 0 });
  assert.deepEqual(await getSeatAvailability(draftId), { capacity: 2, occupied: 0, available: 2 });
  assert.equal(await getSeatAvailability('evt_inexistente'), null);

  // Depois de publicado, o rascunho passa a aceitar compra (X04)
  assert.equal((await a.post(`/organizer/events/${draftId}/publish`, {})).status, 302);
  assert.equal((await buy(p1, draftId, CARD.approve)).status, 302);
  assert.equal((await ticketsOf(draftId)).length, 1);
});
