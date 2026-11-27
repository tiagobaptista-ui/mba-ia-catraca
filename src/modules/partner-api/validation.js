import { EMAIL_RE } from '../accounts/service.js';
import { isValidCardNumber } from '../gateway/index.js';

// Limite de tamanho de endereço de e-mail (RFC 5321); acima disso o e-mail é mal formado.
export const MAX_EMAIL_LENGTH = 254;

// Corpo da compra (F05-CA03): objeto JSON com buyerEmail (string de e-mail bem formado) e cardNumber (string de
// exatamente 16 dígitos, a mesma regra da vitrine, R06). Sem conversões: número, espaços ou traços são inválidos.
// → { buyerEmail, cardNumber } ou null (422 invalid_request). Campos extras são ignorados.
export function parsePurchaseBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const { buyerEmail, cardNumber } = body;
  if (typeof buyerEmail !== 'string' || buyerEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(buyerEmail)) {
    return null;
  }
  if (!isValidCardNumber(cardNumber)) return null;
  return { buyerEmail, cardNumber };
}
