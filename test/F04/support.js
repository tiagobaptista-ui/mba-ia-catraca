// Apoio dos testes de F04 (não é arquivo de teste: não casa com *.test.js).
import { createClient, localDateTimeInDays, SEED } from '../helpers/index.js';
import { query } from '../../src/core/db.js';
import { processDueCharges } from '../../src/modules/gateway/index.js';

// Cartões do gateway simulado (brief): final 0001/0003 aprova (rápido/lento), 0002/0004 recusa.
export const CARD = Object.freeze({
  approve: '4000000000000001',
  decline: '4000000000000002',
  approveSlow: '4000000000000003',
  declineSlow: '4000000000000004',
});

// Campos do formulário de evento de F02, válidos por padrão (data daqui a 30 dias).
export function eventInput(overrides = {}) {
  return {
    name: 'Show F04',
    startsAt: localDateTimeInDays(30),
    venue: 'Porão',
    capacity: '2',
    price: '100,00',
    ...overrides,
  };
}

export async function loginAs(baseUrl, email = SEED.organizerA) {
  const client = createClient(baseUrl);
  await client.login(email);
  return client;
}

// Cria o evento pela área do organizador (F02) e devolve o id; publish=false deixa como rascunho.
export async function createEventVia(organizer, overrides = {}, { publish = true } = {}) {
  const created = await organizer.post('/organizer/events', eventInput(overrides));
  if (created.status !== 302) throw new Error(`criação de evento falhou: ${created.status}\n${created.text}`);
  const id = created.location.split('/').pop();
  if (publish) {
    const published = await organizer.post(`/organizer/events/${id}/publish`, {});
    if (published.status !== 302) throw new Error(`publicação falhou: ${published.status}`);
  }
  return id;
}

let signups = 0;

// Participante novo pelo /signup (X03); o cliente já sai logado.
export async function signupParticipant(baseUrl, name = 'Participante F04') {
  signups += 1;
  const client = createClient(baseUrl);
  const email = `f04.${process.pid}.${signups}.${Date.now()}@teste.dev`;
  const res = await client.post('/signup', { name, email, password: 'segredo123' });
  if (res.status !== 302) throw new Error(`signup falhou: ${res.status}`);
  client.email = email;
  return client;
}

export function buy(client, eventId, cardNumber) {
  return client.post(`/events/${eventId}/purchase`, cardNumber === undefined ? {} : { cardNumber });
}

export async function ticketsOf(eventId) {
  const { rows } = await query('SELECT * FROM tickets WHERE event_id = $1 ORDER BY created_at, id', [eventId]);
  return rows;
}

export async function ticketRow(id) {
  const { rows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function countRows(table, where = 'true', params = []) {
  const { rows } = await query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, params);
  return rows[0].n;
}

// Adiamento temporário das cobranças que o teste não pediu. Intervalo só em horas (sem meses nem dias): somar e
// subtrair é exato em timestamptz, então o respond_at original volta igual, até o microssegundo.
const POSTPONE = "interval '876000 hours'"; // ~100 anos

// Antecipa as respostas do gateway dos ingressos indicados e entrega SÓ essas (testes com workers: false), pelo
// mesmo caminho do worker (processDueCharges). As demais cobranças não respondidas ficam adiadas durante a entrega
// e depois voltam ao instante sorteado: sob carga, uma cobrança lenta (0003/0004, ~0,6–0,8 s com
// GATEWAY_TIME_SCALE=0.02) que o teste quer manter pendente pode já ter vencido, e não deve ser entregue junto.
// Falha se alguma das indicadas ficar sem resposta.
export async function deliverResponses(ticketIds) {
  const { rows: postponed } = await query(
    `UPDATE gateway_charges SET respond_at = respond_at + ${POSTPONE}
      WHERE responded_at IS NULL AND NOT (ticket_id = ANY($1::text[]))
      RETURNING id`,
    [ticketIds],
  );
  try {
    await query("UPDATE gateway_charges SET respond_at = now() - interval '1 second' WHERE ticket_id = ANY($1::text[])", [
      ticketIds,
    ]);
    await processDueCharges({ log: () => {} });
  } finally {
    await query(`UPDATE gateway_charges SET respond_at = respond_at - ${POSTPONE} WHERE id = ANY($1::text[])`, [
      postponed.map((r) => r.id),
    ]);
  }
  const left = await countRows('gateway_charges', 'ticket_id = ANY($1::text[]) AND responded_at IS NULL', [ticketIds]);
  if (left > 0) throw new Error(`${left} cobrança(s) sem resposta depois da entrega`);
}

// Conteúdo do <main> (sem a navegação e o CSS do layout).
export function mainOf(text) {
  const match = /<main>([\s\S]*)<\/main>/.exec(text);
  return match ? match[1] : '';
}

// HTML do extra de vendas (div data-extra="sales") numa página ou trecho; null se não aparece.
export function salesExtraOf(text) {
  const match = /<div class="extra" data-extra="sales">([\s\S]*?)<\/div>/.exec(text);
  return match ? match[1] : null;
}

// HTML do card de um evento na vitrine.
export function cardOf(text, eventId) {
  const match = new RegExp(`<article class="card" data-event-id="${eventId}">([\\s\\S]*?)</article>`).exec(text);
  return match ? match[1] : null;
}

const textOf = (htmlText) => htmlText.replace(/<[^>]*>/g, '').trim();

// Linhas da tabela de "Meus ingressos".
export function myTicketRows(text) {
  return [...text.matchAll(/<tr data-ticket-id="([^"]+)" data-event-id="([^"]+)">([\s\S]*?)<\/tr>/g)].map(
    ([, ticketId, eventId, inner]) => {
      const cells = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
      return {
        ticketId,
        eventId,
        event: cells[0],
        date: cells[1],
        label: cells[2],
        status: /data-status="([^"]+)"/.exec(inner)[1],
        code: cells[3],
        price: cells[4],
      };
    },
  );
}

export const HAS_PURCHASE_FORM = /<form method="post" action="\/events\/[^"]+\/purchase"/;
