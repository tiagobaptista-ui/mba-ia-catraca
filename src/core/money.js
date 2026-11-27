// Dinheiro é sempre inteiro em centavos.

// '150,00' | '150.00' | '150' | '1.234,56' | 'R$ 10,5' → centavos (inteiro), ou null se inválido.
export function parseMoneyToCents(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^R\$\s*/i, '');
  if (s === '') return null;
  if (s.includes(',')) {
    // formato brasileiro: pontos são milhar, vírgula é decimal
    s = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.replace('-', '').split('.');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return s.startsWith('-') ? -cents : cents;
}

// 35000 → 'R$ 350,00'; 123456 → 'R$ 1.234,56' (espaço comum, não NBSP)
export function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reais},${centavos}`;
}

// 10000 → '100,00' (para preencher campo de formulário)
export function centsToInput(cents) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
