import express from 'express';
import { toIsoOffset } from '../../core/time.js';
import { listOnSaleEvents } from '../events/service.js';
import { getAvailabilityMap } from '../sales/service.js';
import { hasValidApiKey, requireApiKey, sendUnauthorized } from './auth.js';

// API de parceiros (F05), contrato fixo do brief. Toda rota sob /api/partner exige X-Api-Key; as respostas são
// sempre JSON. Caminho desconhecido com chave válida cai no 404 JSON do app ({"error":"not_found"}).
export const BASE_PATH = '/api/partner';

export function sendError(res, status, error) {
  return res.status(status).json({ error });
}

// Evento no formato do contrato: startsAt em ISO 8601 com offset −03:00, preço atual em centavos (X09).
export function partnerEvent(event, availableSeats) {
  return {
    id: event.id,
    name: event.name,
    startsAt: toIsoOffset(event.startsAt),
    priceCents: event.priceCents,
    availableSeats,
  };
}

function partnerRoutes() {
  const router = express.Router();
  // A chave vem antes de tudo, inclusive do parse do corpo (o parser JSON fica nas rotas, depois deste middleware).
  router.use(requireApiKey);

  // Eventos à venda: publicados e não cancelados (R02), com as vagas disponíveis de R05.
  router.get('/events', async (_req, res) => {
    const events = await listOnSaleEvents();
    const available = await getAvailabilityMap(events.map((event) => event.id));
    res.json(events.map((event) => partnerEvent(event, available.get(event.id) ?? 0)));
  });

  return router;
}

// Erros de leitura de corpo têm `type` e status 4xx (body-parser: JSON malformado, charset, tamanho…).
function isBodyError(err) {
  return Boolean(err) && typeof err.type === 'string' && Number.isInteger(err.status) && err.status >= 400
    && err.status < 500;
}

// Tratador de erros de /api/partner (nível do app: um router não recebe erros vindos de antes dele). Um erro que
// chega antes da checagem da chave — ex.: corpo urlencoded que o parser global do app não conseguiu ler — ainda
// responde 401 sem chave válida; com chave, corpo ilegível é 422 invalid_request. O resto segue para o 500 do app.
function partnerErrors(err, req, res, next) {
  if (!hasValidApiKey(req)) return sendUnauthorized(res);
  if (isBodyError(err)) return sendError(res, 422, 'invalid_request');
  return next(err);
}

export default {
  name: 'partner-api',
  order: 50,
  register(app) {
    app.use(BASE_PATH, partnerRoutes());
    app.use(BASE_PATH, partnerErrors);
  },
};
