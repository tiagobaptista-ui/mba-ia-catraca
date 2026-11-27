import { config } from '../../core/config.js';

// Gateway simulado do brief: a resposta depende só do final (últimos 4 dígitos) do cartão.
// As faixas ficam dentro das do brief com folga para o intervalo de varredura do worker (200 ms):
// rápido 2000–4500 ms (brief: 2–5 s) e lento 30500–39500 ms (brief: 30–40 s).
export const FAST_RANGE_MS = Object.freeze([2000, 4500]);
export const SLOW_RANGE_MS = Object.freeze([30500, 39500]);

const TABLE = {
  '0001': { outcome: 'approved', range: FAST_RANGE_MS },
  '0002': { outcome: 'declined', range: FAST_RANGE_MS },
  '0003': { outcome: 'approved', range: SLOW_RANGE_MS },
  '0004': { outcome: 'declined', range: SLOW_RANGE_MS },
};
const OTHER = { outcome: 'declined', range: FAST_RANGE_MS };

// Número de cartão válido: string com exatamente 16 dígitos (0–9). Número JS, espaços ou traços são inválidos.
export function isValidCardNumber(card) {
  return typeof card === 'string' && /^[0-9]{16}$/.test(card);
}

// Sorteio uniforme de inteiro em [min, max]; rng devolve [0, 1) como Math.random.
function uniformInt([min, max], rng) {
  const value = min + Math.floor(rng() * (max - min + 1));
  return Math.min(max, Math.max(min, value));
}

// → { outcome: 'approved' | 'declined', delayMs } pelo final do cartão (não valida o número: isso é
// isValidCardNumber / requestCharge). delayMs é o tempo real, sem a escala de GATEWAY_TIME_SCALE.
export function simulateResponse(cardNumber, rng = Math.random) {
  const rule = TABLE[String(cardNumber).slice(-4)] || OTHER;
  return { outcome: rule.outcome, delayMs: uniformInt(rule.range, rng) };
}

// Tempo de resposta efetivo: delayMs × GATEWAY_TIME_SCALE (padrão 1; os gates usam 0,02 só para acelerar).
export function scaledDelay(delayMs, scale = config.gatewayTimeScale) {
  return Math.round(delayMs * scale);
}
