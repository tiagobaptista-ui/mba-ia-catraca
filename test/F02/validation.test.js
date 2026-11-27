import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateEventInput, MESSAGES } from '../../src/modules/events/service.js';
import { closeDb } from '../helpers/index.js';

after(closeDb);

const NOW = new Date('2026-11-27T12:00:00-03:00');
const valid = { name: ' Jazz no Porão ', startsAt: '2026-12-27T21:00', venue: ' Porão ', capacity: '2', price: '100,00' };
const check = (overrides) => validateEventInput({ ...valid, ...overrides }, { now: NOW });

test('validateEventInput: entrada válida vira valores normalizados (data em −03:00, centavos)', () => {
  const { values, errors } = check({});
  assert.deepEqual(errors, []);
  assert.equal(values.name, 'Jazz no Porão');
  assert.equal(values.venue, 'Porão');
  assert.equal(values.startsAt.toISOString(), '2026-12-28T00:00:00.000Z');
  assert.equal(values.capacity, 2);
  assert.equal(values.priceCents, 10000);
  assert.equal(check({ price: '1.234,56' }).values.priceCents, 123456);
  assert.equal(check({ price: '150.5' }).values.priceCents, 15050);
});

test('F02-CA02 (R01): data de início no passado ou igual a agora é rejeitada com a mensagem exata', () => {
  assert.equal(MESSAGES.pastStart, 'A data de início precisa estar no futuro.');
  assert.deepEqual(check({ startsAt: '2026-11-26T21:00' }).errors, ['A data de início precisa estar no futuro.']);
  assert.deepEqual(check({ startsAt: '2026-11-27T12:00' }).errors, ['A data de início precisa estar no futuro.']);
  assert.deepEqual(check({ startsAt: '2026-11-27T12:01' }).errors, []);
});

test('F02-CA02 (R01): data ausente ou inválida é rejeitada', () => {
  assert.deepEqual(check({ startsAt: '' }).errors, ['Informe a data e hora de início.']);
  assert.deepEqual(check({ startsAt: '27/12/2026 21:00' }).errors, ['Data e hora de início inválidas.']);
  assert.deepEqual(check({ startsAt: '2026-02-30T21:00' }).errors, ['Data e hora de início inválidas.']);
});

test('F02-CA02 (R01): lotação precisa ser inteira ≥ 1', () => {
  const msg = 'A lotação precisa ser um número inteiro maior ou igual a 1.';
  for (const capacity of ['0', '-1', '1.5', '2,0', 'abc', '', undefined]) {
    assert.deepEqual(check({ capacity }).errors, [msg], `capacity=${capacity}`);
  }
  assert.deepEqual(check({ capacity: '1' }).errors, []);
  assert.deepEqual(check({ capacity: 7 }).errors, []);
  assert.deepEqual(check({ capacity: '100001' }).errors, ['A lotação máxima é 100.000.']);
});

test('F02-CA02 (R01): preço precisa ser válido e maior que zero', () => {
  for (const price of ['0', '0,00', '-10,00']) {
    assert.deepEqual(check({ price }).errors, ['O preço precisa ser maior que zero.'], `price=${price}`);
  }
  for (const price of ['abc', '', '10,999', undefined]) {
    assert.deepEqual(check({ price }).errors, ['Informe um preço válido, como 100,00.'], `price=${price}`);
  }
  assert.deepEqual(check({ price: '0,01' }).errors, []);
  assert.deepEqual(check({ price: '1.000.000,01' }).errors, ['O preço máximo é R$ 1.000.000,00.']);
});

test('F02-CA02: nome e local obrigatórios (só espaços conta como vazio) e com tamanho máximo', () => {
  assert.deepEqual(check({ name: '   ' }).errors, ['Informe o nome do evento.']);
  assert.deepEqual(check({ venue: undefined }).errors, ['Informe o local.']);
  assert.deepEqual(check({ name: 'x'.repeat(201) }).errors, ['O nome pode ter no máximo 200 caracteres.']);
  assert.deepEqual(check({ venue: 'x'.repeat(201) }).errors, ['O local pode ter no máximo 200 caracteres.']);
});

test('F02-CA02: formulário vazio lista um erro por campo', () => {
  const { errors } = validateEventInput({}, { now: NOW });
  assert.equal(errors.length, 5);
});
