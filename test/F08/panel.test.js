// Seção "Painel" na página de gestão (F08-CA01, F08-CA06, X17), sem o worker do gateway: o teste entrega as
// respostas (deliverResponses) e observa cada estado de forma determinística.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED } from '../helpers/index.js';
import { purchaseTicket } from '../../src/modules/sales/service.js';
import {
  CARD,
  METRIC_LABELS,
  buy,
  cancelEvent,
  checkIn,
  createEventVia,
  dashboardSectionOf,
  deliverResponses,
  eventInput,
  holdResponses,
  loginAs,
  metricsOf,
  panel,
  readPanel,
  sectionKeys,
  ticketIdsOf,
} from './support.js';

const app = useTestApp({ workers: false });

test('F08-CA01, X17 (R04, R12): painel no topo da gestão, com os seis rótulos exatos e um data-metric por número', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const eventId = await createEventVia(a, { name: 'Painel C01', capacity: '2', price: '100,00' });

  const page = await a.get(`/organizer/events/${eventId}`);
  assert.equal(page.status, 200);
  // order 10: logo depois dos dados do evento (0) e antes da publicação (40) e da edição (50)
  const keys = sectionKeys(page.text);
  assert.equal(keys.filter((k) => k === 'dashboard').length, 1);
  assert.ok(keys.indexOf('dashboard') < keys.indexOf('publish'), keys.join(','));
  assert.ok(keys.indexOf('dashboard') < keys.indexOf('edit'), keys.join(','));
  assert.ok(keys.indexOf('details') < keys.indexOf('dashboard'), keys.join(','));

  const section = dashboardSectionOf(page.text);
  assert.match(section, /<h2>Painel<\/h2>/);
  const pairs = [...section.matchAll(/<dt>([^<]*)<\/dt><dd data-metric="([a-z]+)">([^<]*)<\/dd>/g)].map(
    ([, label, key, value]) => ({ label, key, value }),
  );
  assert.deepEqual(
    pairs.map(({ label, key }) => [label, key]),
    Object.entries(METRIC_LABELS).map(([key, label]) => [label, key]),
  );
  assert.deepEqual(metricsOf(page.text), panel({ available: 2 }));
  assert.doesNotMatch(section, /<form/);

  // rascunho também mostra o painel (sem vendas)
  const draftId = await createEventVia(a, { name: 'Rascunho', capacity: '5' }, { publish: false });
  assert.deepEqual(await readPanel(a, draftId), panel({ available: 5 }));
});

test('Fluxo do avaliador, passo 9 (R03, R05, R12): 3 confirmados pagos 100 + 100 + 150 → R$ 350,00 e 0 vagas', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const p = await loginAs(app.baseUrl, SEED.participant);
  const eventId = await createEventVia(a, { name: 'Passo 9', capacity: '2', price: '100,00' });

  // compra lenta (0003): pendente, segura a vaga, sem receita
  assert.equal((await buy(p, eventId, CARD.approveSlow)).status, 302);
  const [slow] = await ticketIdsOf(eventId);
  await holdResponses([slow]);
  assert.deepEqual(await readPanel(a, eventId), panel({ pending: 1, available: 1 }));

  // compra rápida (0001) aprovada
  assert.equal((await buy(p, eventId, CARD.approve)).status, 302);
  const [, fast] = await ticketIdsOf(eventId);
  await deliverResponses([fast]);
  assert.deepEqual(await readPanel(a, eventId), panel({ confirmed: 1, pending: 1, available: 0, revenue: 'R$ 100,00' }));

  // lotação 3 e preço 150,00; nova compra aprovada vale 150 (X18: preço gravado na compra)
  const edit = await a.post(`/organizer/events/${eventId}`, eventInput({ name: 'Passo 9', capacity: '3', price: '150,00' }));
  assert.equal(edit.status, 302);
  assert.equal((await buy(p, eventId, CARD.approve)).status, 302);
  const [, , third] = await ticketIdsOf(eventId);
  await deliverResponses([third]);
  assert.deepEqual(await readPanel(a, eventId), panel({ confirmed: 2, pending: 1, available: 0, revenue: 'R$ 250,00' }));

  // a aprovação lenta chega: o primeiro ingresso entra a 100 (preço da compra), não a 150
  await deliverResponses([slow]);
  assert.deepEqual(await readPanel(a, eventId), panel({ confirmed: 3, available: 0, revenue: 'R$ 350,00' }));

  // check-in (F06 simulado) não muda Confirmados
  await checkIn(slow);
  assert.deepEqual(await readPanel(a, eventId), panel({ confirmed: 3, checkins: 1, available: 0, revenue: 'R$ 350,00' }));

  // esgotado; com lotação 4, uma compra recusada (0002) não conta e devolve a vaga
  assert.equal((await buy(p, eventId, CARD.approve)).status, 409);
  await a.post(`/organizer/events/${eventId}`, eventInput({ name: 'Passo 9', capacity: '4', price: '150,00' }));
  assert.equal((await buy(p, eventId, CARD.decline)).status, 302);
  const [, , , declined] = await ticketIdsOf(eventId);
  await deliverResponses([declined]);
  assert.deepEqual(await readPanel(a, eventId), panel({ confirmed: 3, checkins: 1, available: 1, revenue: 'R$ 350,00' }));

  // cancelamento (F07 simulado): estornos fora de Confirmados, Check-ins e Receita; 0 vagas
  await cancelEvent(eventId);
  assert.deepEqual(await readPanel(a, eventId), panel({ available: 0, refunded: 3 }));
});

test('F08-CA05 (R12): compras pela API de parceiros aparecem no painel junto com as da vitrine', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const p = await loginAs(app.baseUrl, SEED.participant);
  const eventId = await createEventVia(a, { name: 'Canais', capacity: '5', price: '40,00' });

  assert.equal((await buy(p, eventId, CARD.approve)).status, 302);
  const partner = await purchaseTicket({
    eventId,
    cardNumber: CARD.approve,
    buyerEmail: 'parceiro@example.com',
    channel: 'partner',
  });
  assert.equal(partner.ok, true);
  const slow = await purchaseTicket({
    eventId,
    cardNumber: CARD.approveSlow,
    buyerEmail: 'lento@example.com',
    channel: 'partner',
  });
  await holdResponses([slow.ticket.id]);
  const [storefront] = await ticketIdsOf(eventId);
  await deliverResponses([storefront, partner.ticket.id]);
  await checkIn(partner.ticket.id);

  assert.deepEqual(
    await readPanel(a, eventId),
    panel({ confirmed: 2, pending: 1, checkins: 1, available: 2, revenue: 'R$ 80,00' }),
  );
});

test('F08-CA06, X17 (R13): organizador B não vê o painel de A; participante e visitante não entram', async () => {
  const a = await loginAs(app.baseUrl, SEED.organizerA);
  const p = await loginAs(app.baseUrl, SEED.participant);
  const eventId = await createEventVia(a, { name: 'Segredo de A', capacity: '3', price: '123,45' });
  assert.equal((await buy(p, eventId, CARD.approve)).status, 302);
  await deliverResponses(await ticketIdsOf(eventId));
  assert.equal((await readPanel(a, eventId)).revenue, 'R$ 123,45');

  const b = await loginAs(app.baseUrl, SEED.organizerB);
  const res = await b.get(`/organizer/events/${eventId}`);
  assert.equal(res.status, 404);
  assert.match(res.text, /Evento não encontrado/);
  assert.doesNotMatch(res.text, /data-metric|data-section="dashboard"|Painel/);
  assert.doesNotMatch(res.text, /Segredo de A|123,45/);

  // B vê o painel do próprio evento, sem os números de A
  const own = await createEventVia(b, { name: 'Evento de B', capacity: '9', price: '10,00' });
  assert.deepEqual(await readPanel(b, own), panel({ available: 9 }));

  const participant = await p.get(`/organizer/events/${eventId}`);
  assert.equal(participant.status, 403);
  assert.doesNotMatch(participant.text, /data-metric|Segredo de A/);
  const visitor = await createClient(app.baseUrl).get(`/organizer/events/${eventId}`);
  assert.equal(visitor.status, 302);
  assert.match(visitor.location, /^\/login/);
});
