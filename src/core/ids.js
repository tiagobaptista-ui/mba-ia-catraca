import { randomInt } from 'node:crypto';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
// Sem 0/O/1/I para o código ser fácil de ler e digitar na porta.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

// newId('evt') → 'evt_k3m9q2x7ab'
export function newId(prefix) {
  return `${prefix}_${randomString(ID_ALPHABET, 10)}`;
}

// Código de ingresso: 8 caracteres maiúsculos (32^8 ≈ 1,1 trilhão de combinações).
export function newTicketCode() {
  return randomString(CODE_ALPHABET, 8);
}

export const TICKET_CODE_ALPHABET = CODE_ALPHABET;
