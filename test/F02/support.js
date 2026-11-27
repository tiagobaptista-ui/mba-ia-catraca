// Apoio dos testes de F02 (não é arquivo de teste: não casa com *.test.js).
import { localDateTimeInDays } from '../helpers/index.js';
import { query } from '../../src/core/db.js';

// Campos do formulário de evento, válidos por padrão (data daqui a 30 dias).
export function eventInput(overrides = {}) {
  return {
    name: 'Jazz F02',
    startsAt: localDateTimeInDays(30),
    venue: 'Porão',
    capacity: '2',
    price: '100,00',
    ...overrides,
  };
}

// Cria um evento pelo formulário (cliente logado como organizador) e devolve o id.
export async function createEventVia(client, overrides = {}) {
  const res = await client.post('/organizer/events', eventInput(overrides));
  if (res.status !== 302) throw new Error(`criação de evento falhou: ${res.status}\n${res.text}`);
  return res.location.split('/').pop();
}

export async function publishVia(client, id) {
  const res = await client.post(`/organizer/events/${id}/publish`, {});
  if (res.status !== 302) throw new Error(`publicação falhou: ${res.status}`);
  return res;
}

export async function eventRow(id) {
  const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function countEvents() {
  const { rows } = await query('SELECT count(*) AS n FROM events');
  return rows[0].n;
}

// Conteúdo do <main> (sem a navegação e o CSS do layout).
export function mainOf(text) {
  const match = /<main>([\s\S]*)<\/main>/.exec(text);
  return match ? match[1] : '';
}

// Texto visível do <main> (sem tags).
export function mainText(text) {
  return mainOf(text).replace(/<[^>]*>/g, ' ');
}

// Keys das seções da página de gestão, na ordem em que aparecem.
export function sectionKeys(text) {
  return [...text.matchAll(/<section data-section="([^"]+)"/g)].map((m) => m[1]);
}

// HTML de uma seção (por key).
export function sectionOf(text, key) {
  const match = new RegExp(`<section data-section="${key}">([\\s\\S]*?)</section>`).exec(text);
  return match ? match[1] : null;
}
