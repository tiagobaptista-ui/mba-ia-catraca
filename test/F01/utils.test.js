import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyToCents, formatCents, centsToInput } from '../../src/core/money.js';
import { parseLocalDateTime, formatDateTimeBR, toIsoOffset, toDateTimeLocalValue } from '../../src/core/time.js';
import { newId, newTicketCode, TICKET_CODE_ALPHABET } from '../../src/core/ids.js';
import { html, raw } from '../../src/core/html.js';

test('dinheiro: parse de formatos brasileiros e decimais', () => {
  assert.equal(parseMoneyToCents('100,00'), 10000);
  assert.equal(parseMoneyToCents('150.00'), 15000);
  assert.equal(parseMoneyToCents('150'), 15000);
  assert.equal(parseMoneyToCents('1.234,56'), 123456);
  assert.equal(parseMoneyToCents('R$ 10,5'), 1050);
  assert.equal(parseMoneyToCents('0'), 0);
  assert.equal(parseMoneyToCents('-5'), -500);
  assert.equal(parseMoneyToCents('abc'), null);
  assert.equal(parseMoneyToCents('10,999'), null);
  assert.equal(parseMoneyToCents(''), null);
  assert.equal(parseMoneyToCents(undefined), null);
});

test('dinheiro: formatação R$ com espaço comum', () => {
  assert.equal(formatCents(35000), 'R$ 350,00');
  assert.equal(formatCents(0), 'R$ 0,00');
  assert.equal(formatCents(123456), 'R$ 1.234,56');
  assert.equal(formatCents(5), 'R$ 0,05');
  assert.equal(centsToInput(15000), '150,00');
});

test('datas: entrada e saída no fuso −03:00', () => {
  const date = parseLocalDateTime('2026-12-05T21:00');
  assert.equal(date.toISOString(), '2026-12-06T00:00:00.000Z');
  assert.equal(toIsoOffset(date), '2026-12-05T21:00:00-03:00');
  assert.equal(formatDateTimeBR(date), '05/12/2026 21:00');
  assert.equal(toDateTimeLocalValue(date), '2026-12-05T21:00');
  assert.equal(parseLocalDateTime('2026-02-30T10:00'), null);
  assert.equal(parseLocalDateTime('ontem'), null);
  assert.equal(parseLocalDateTime(''), null);
});

test('ids e códigos de ingresso', () => {
  assert.match(newId('evt'), /^evt_[a-z2-9]{10}$/);
  const codes = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const code = newTicketCode();
    assert.equal(code.length, 8);
    for (const ch of code) assert.ok(TICKET_CODE_ALPHABET.includes(ch));
    codes.add(code);
  }
  assert.equal(codes.size, 2000);
});

test('html escapa interpolações e respeita raw', () => {
  const name = '<script>alert("x")</script>';
  assert.equal(html`<p>${name}</p>`.toString(), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(html`<p>${raw('<b>ok</b>')}</p>`.toString(), '<p><b>ok</b></p>');
  assert.equal(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`.toString(), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(html`${null}${undefined}${false}`.toString(), '');
});
