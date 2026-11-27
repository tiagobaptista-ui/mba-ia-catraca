import { query, withTransaction } from '../../core/db.js';
import { newId } from '../../core/ids.js';
import { parseLocalDateTime } from '../../core/time.js';
import { parseMoneyToCents } from '../../core/money.js';

// Ciclo de vida: draft → published → cancelled (F07 faz a última transição). À venda = published (R02).
export const EVENT_STATUS_LABELS = { draft: 'Rascunho', published: 'Publicado', cancelled: 'Cancelado' };

export const MESSAGES = {
  pastStart: 'A data de início precisa estar no futuro.',
  cancelledEdit: 'Evento cancelado não pode ser editado.',
  cancelledPublish: 'Evento cancelado não pode ser republicado.',
  alreadyPublished: 'Evento já está publicado.',
};

const MAX_TEXT = 200;
const MAX_CAPACITY = 100_000;
const MAX_PRICE_CENTS = 100_000_000; // R$ 1.000.000,00 (cabe no integer do banco)

export function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    startsAt: row.starts_at,
    venue: row.venue,
    capacity: row.capacity,
    priceCents: row.price_cents,
    status: row.status,
    publishedAt: row.published_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isOnSale(event) {
  return Boolean(event) && event.status === 'published';
}

const text = (value) => (value === undefined || value === null ? '' : String(value).trim());

// Valida os campos do formulário de evento (criar e editar). R01: data de início no futuro, lotação inteira ≥ 1,
// preço > 0. Retorna { values: { name, startsAt, venue, capacity, priceCents }, errors: string[] }.
export function validateEventInput(input = {}, { now = new Date() } = {}) {
  const errors = [];
  const name = text(input.name);
  const venue = text(input.venue);
  const startsAtRaw = text(input.startsAt);
  const capacityRaw = text(input.capacity);
  const priceRaw = text(input.price);

  if (!name) errors.push('Informe o nome do evento.');
  else if (name.length > MAX_TEXT) errors.push(`O nome pode ter no máximo ${MAX_TEXT} caracteres.`);

  let startsAt = null;
  if (!startsAtRaw) {
    errors.push('Informe a data e hora de início.');
  } else {
    startsAt = parseLocalDateTime(startsAtRaw);
    if (!startsAt) errors.push('Data e hora de início inválidas.');
    else if (startsAt.getTime() <= now.getTime()) errors.push(MESSAGES.pastStart);
  }

  if (!venue) errors.push('Informe o local.');
  else if (venue.length > MAX_TEXT) errors.push(`O local pode ter no máximo ${MAX_TEXT} caracteres.`);

  let capacity = null;
  if (!/^\d+$/.test(capacityRaw) || Number(capacityRaw) < 1) {
    errors.push('A lotação precisa ser um número inteiro maior ou igual a 1.');
  } else if (Number(capacityRaw) > MAX_CAPACITY) {
    errors.push('A lotação máxima é 100.000.');
  } else {
    capacity = Number(capacityRaw);
  }

  let priceCents = null;
  const parsedPrice = priceRaw ? parseMoneyToCents(priceRaw) : null;
  if (parsedPrice === null) {
    errors.push('Informe um preço válido, como 100,00.');
  } else if (parsedPrice <= 0) {
    errors.push('O preço precisa ser maior que zero.');
  } else if (parsedPrice > MAX_PRICE_CENTS) {
    errors.push('O preço máximo é R$ 1.000.000,00.');
  } else {
    priceCents = parsedPrice;
  }

  return { values: { name, startsAt, venue, capacity, priceCents }, errors };
}

// ---- Capacity guard (R03) -------------------------------------------------------------------------------
// fn(client, event, newCapacity) → Promise<string | null>: mensagem de erro quando a nova lotação fica abaixo das
// vagas ocupadas. Registrado por F04; sem guard, a redução é aceita (ainda não há ingressos).
let capacityGuard = null;

export function setCapacityGuard(fn) {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('setCapacityGuard espera uma função ou null');
  capacityGuard = fn;
}

// ---- Escrita --------------------------------------------------------------------------------------------

// Trava a linha do evento (SELECT … FOR UPDATE). Disciplina de lock compartilhada: compra (F04), edição de lotação
// e cancelamento (F07) travam esta linha, o que serializa as operações que mexem em vagas.
export async function lockEvent(client, eventId) {
  const { rows } = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  return mapEvent(rows[0]);
}

// Cria o evento como rascunho (R02). → { event } ou { errors, values }
export async function createEvent(organizerId, input, { now } = {}) {
  const { values, errors } = validateEventInput(input, { now });
  if (errors.length > 0) return { errors, values };
  const { rows } = await query(
    `INSERT INTO events (id, organizer_id, name, starts_at, venue, capacity, price_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING *`,
    [newId('evt'), organizerId, values.name, values.startsAt, values.venue, values.capacity, values.priceCents],
  );
  return { event: mapEvent(rows[0]) };
}

// Edita o evento do organizador. → { event }, { errors, values, status } ou { notFound: true }
export async function updateEvent(organizerId, eventId, input, { now } = {}) {
  return withTransaction(async (client) => {
    const current = await lockEvent(client, eventId);
    if (!current || current.organizerId !== organizerId) return { notFound: true };
    if (current.status === 'cancelled') return { errors: [MESSAGES.cancelledEdit], values: null, status: 409 }; // R11

    const { values, errors } = validateEventInput(input, { now }); // R01 vale também ao editar
    if (errors.length > 0) return { errors, values, status: 422 };

    // R03: reduzir a lotação passa pelo capacity guard, com a linha do evento travada.
    if (values.capacity < current.capacity && capacityGuard) {
      const guardError = await capacityGuard(client, current, values.capacity);
      if (guardError) return { errors: [guardError], values, status: 409 };
    }

    const { rows } = await client.query(
      `UPDATE events
          SET name = $2, starts_at = $3, venue = $4, capacity = $5, price_cents = $6, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [eventId, values.name, values.startsAt, values.venue, values.capacity, values.priceCents],
    );
    return { event: mapEvent(rows[0]) };
  });
}

// Publica um rascunho (R02). → { event }, { errors, status: 409 } ou { notFound: true }
export async function publishEvent(organizerId, eventId) {
  return withTransaction(async (client) => {
    const current = await lockEvent(client, eventId);
    if (!current || current.organizerId !== organizerId) return { notFound: true };
    if (current.status === 'cancelled') return { errors: [MESSAGES.cancelledPublish], status: 409 }; // R11
    if (current.status === 'published') return { errors: [MESSAGES.alreadyPublished], status: 409 };
    const { rows } = await client.query(
      `UPDATE events SET status = 'published', published_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [eventId],
    );
    return { event: mapEvent(rows[0]) };
  });
}

// ---- Leitura --------------------------------------------------------------------------------------------

export async function getEvent(id) {
  if (typeof id !== 'string' || id === '') return null;
  const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
  return mapEvent(rows[0]);
}

// Evento só se for do organizador (R13); caso contrário null.
export async function getOwnedEvent(organizerId, id) {
  if (typeof id !== 'string' || id === '' || !organizerId) return null;
  const { rows } = await query('SELECT * FROM events WHERE id = $1 AND organizer_id = $2', [id, organizerId]);
  return mapEvent(rows[0]);
}

export async function listOrganizerEvents(organizerId) {
  const { rows } = await query('SELECT * FROM events WHERE organizer_id = $1 ORDER BY starts_at, created_at', [
    organizerId,
  ]);
  return rows.map(mapEvent);
}

// Eventos à venda: publicados (e, por consequência, não cancelados) — R02.
export async function listOnSaleEvents() {
  const { rows } = await query("SELECT * FROM events WHERE status = 'published' ORDER BY starts_at, created_at");
  return rows.map(mapEvent);
}
