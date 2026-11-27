import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../../core/config.js';

// Autenticação da API de parceiros (F05-CA05, X08): cabeçalho X-Api-Key igual à chave configurada pelo harness
// (config.partnerApiKey, env PARTNER_API_KEY). A chave é lida da configuração a cada requisição.

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest();

// Comparação em tempo constante: os dois lados viram digests de mesmo tamanho antes do timingSafeEqual, então nem o
// conteúdo nem o comprimento da chave vazam pelo tempo de resposta.
export function isValidApiKey(value) {
  if (typeof value !== 'string' || value === '') return false;
  return timingSafeEqual(sha256(value), sha256(config.partnerApiKey));
}

export function hasValidApiKey(req) {
  return isValidApiKey(req.get('X-Api-Key'));
}

export function sendUnauthorized(res) {
  return res.status(401).json({ error: 'unauthorized' });
}

// Primeiro middleware de /api/partner: sem chave válida, 401 antes de qualquer outra coisa (corpo, rota, evento).
export function requireApiKey(req, res, next) {
  if (!hasValidApiKey(req)) return sendUnauthorized(res);
  return next();
}
