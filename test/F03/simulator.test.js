import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCardNumber, simulateResponse, scaledDelay } from '../../src/modules/gateway/simulator.js';

const RNG_EXTREMES = [0, 0.5, 0.9999999999];
const fixed = (value) => () => value;

// Contrato C01 (F03-CA01): tabela do brief, inclusive nos extremos do rng.
test('simulateResponse segue a tabela do brief', () => {
  const cases = [
    { card: '4000000000000001', outcome: 'approved', min: 2000, max: 5000 },
    { card: '4000000000000002', outcome: 'declined', min: 2000, max: 5000 },
    { card: '4000000000000003', outcome: 'approved', min: 30000, max: 40000 },
    { card: '4000000000000004', outcome: 'declined', min: 30000, max: 40000 },
    { card: '4000000000000000', outcome: 'declined', min: 2000, max: 5000 },
    { card: '4000000000000005', outcome: 'declined', min: 2000, max: 5000 },
    { card: '4000000000000010', outcome: 'declined', min: 2000, max: 5000 },
    { card: '4000000000010001', outcome: 'approved', min: 2000, max: 5000 }, // só os 4 últimos contam
    { card: '1234567812349999', outcome: 'declined', min: 2000, max: 5000 },
  ];
  for (const { card, outcome, min, max } of cases) {
    for (const r of RNG_EXTREMES) {
      const res = simulateResponse(card, fixed(r));
      assert.equal(res.outcome, outcome, `${card} com rng=${r}`);
      assert.ok(Number.isInteger(res.delayMs), `${card}: delayMs inteiro`);
      assert.ok(res.delayMs >= min && res.delayMs <= max, `${card} com rng=${r}: ${res.delayMs} fora de [${min}, ${max}]`);
    }
    for (let i = 0; i < 500; i += 1) {
      const res = simulateResponse(card);
      assert.equal(res.outcome, outcome);
      assert.ok(res.delayMs >= min && res.delayMs <= max, `${card}: ${res.delayMs} fora de [${min}, ${max}]`);
    }
  }

  // Extremos exatos da spec (folga para a varredura de 200 ms do worker).
  assert.equal(simulateResponse('4000000000000001', fixed(0)).delayMs, 2000);
  assert.equal(simulateResponse('4000000000000001', fixed(0.9999999999)).delayMs, 4500);
  assert.equal(simulateResponse('4000000000000003', fixed(0)).delayMs, 30500);
  assert.equal(simulateResponse('4000000000000004', fixed(0.9999999999)).delayMs, 39500);
  assert.equal(simulateResponse('4000000000000007', fixed(0.9999999999)).delayMs, 4500);
});

// Contrato C02 (F03-CA02): só string de exatamente 16 dígitos.
test('isValidCardNumber', () => {
  assert.equal(isValidCardNumber('4000000000000001'), true);
  assert.equal(isValidCardNumber('0000000000000000'), true);

  const invalid = [
    '400000000000001', // 15 dígitos
    '40000000000000001', // 17 dígitos
    '400000000000000a', // letra
    'abcdefghijklmnop',
    '4000 0000 0000 0001',
    '4000-0000-0000-0001',
    ' 4000000000000001',
    '4000000000000001 ',
    '4000000000000001\n',
    '٤٠٠٠٠٠٠٠٠٠٠٠٠٠٠١', // dígitos não ASCII
    '',
    4000000000000001, // número JS
    null,
    undefined,
    {},
    ['4000000000000001'],
  ];
  for (const card of invalid) assert.equal(isValidCardNumber(card), false, `${JSON.stringify(card)} deveria ser inválido`);
});

test('scaledDelay aplica GATEWAY_TIME_SCALE', () => {
  assert.equal(scaledDelay(3000, 1), 3000);
  assert.equal(scaledDelay(3000, 0.02), 60);
  assert.equal(scaledDelay(30500, 0.02), 610);
  assert.equal(scaledDelay(2345, 0.02), 47);
});
