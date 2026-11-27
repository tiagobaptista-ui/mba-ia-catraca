// Template HTML com escape automático: tudo que é interpolado é escapado, exceto valores Raw
// (resultado de outro html`` ou de raw()). Arrays são concatenados; null/undefined/false viram ''.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Raw {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new Raw(value);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}
