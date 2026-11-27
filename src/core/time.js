// Datas da Catraca: entrada e exibição em America/Sao_Paulo, que desde 2019 é UTC−03:00 o ano todo.
export const OFFSET = '-03:00';
const OFFSET_MS = -3 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

// Campos de calendário da data no fuso −03:00.
function localParts(date) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: pad(shifted.getUTCMonth() + 1),
    day: pad(shifted.getUTCDate()),
    hour: pad(shifted.getUTCHours()),
    minute: pad(shifted.getUTCMinutes()),
    second: pad(shifted.getUTCSeconds()),
  };
}

// '2026-12-26T21:00' (valor de <input type="datetime-local">) → Date, ou null se inválido.
export function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00'] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  const back = localParts(date);
  if (back.month !== mo || back.day !== d || back.hour !== h || back.minute !== mi) return null;
  return date;
}

// Date → '26/12/2026 21:00'
export function formatDateTimeBR(date) {
  const p = localParts(new Date(date));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Date → '2026-12-26T21:00:00-03:00'
export function toIsoOffset(date) {
  const p = localParts(new Date(date));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${OFFSET}`;
}

// Date → '2026-12-26T21:00' (para preencher <input type="datetime-local">)
export function toDateTimeLocalValue(date) {
  const p = localParts(new Date(date));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
