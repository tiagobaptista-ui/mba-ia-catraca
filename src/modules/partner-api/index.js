import express from 'express';
import { toIsoOffset } from '../../core/time.js';
import { listOnSaleEvents } from '../events/service.js';
import { getAvailabilityMap, purchaseTicket } from '../sales/service.js';
import { hasValidApiKey, requireApiKey, sendUnauthorized } from './auth.js';
import { parsePurchaseBody } from './validation.js';

// API de parceiros (F05), contrato fixo do brief. Toda rota sob /api/partner exige X-Api-Key; as respostas são
// sempre JSON. Caminho desconhecido com chave válida cai no 404 JSON do app ({"error":"not_found"}).
export const BASE_PATH = '/api/partner';

export function sendError(res, status, error) {
  return res.status(status).json({ error });
}

// Falhas de purchaseTicket → resposta da API. invalid_card não deveria chegar aqui (o corpo já foi validado com a
// mesma regra), mas, se chegar, é corpo inválido.
const PURCHASE_ERRORS = Object.freeze({
  invalid_card: { status: 422, error: 'invalid_request' },
  event_not_available: { status: 404, error: 'event_not_available' }, // inexistente, rascunho ou cancelado (R02)
  sold_out: { status: 409, error: 'sold_out' }, // R07
});

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

  // Compra de um ingresso (R06) pelo mesmo serviço da vitrine: mesma lotação e mesmo lock do evento (R07).
  // Ordem dos erros: 422 corpo inválido → 404 evento fora de venda → 409 sem vaga. O corpo precisa ser JSON
  // (application/json); JSON malformado vira 422 em partnerErrors.
  router.post('/events/:eventId/purchases', express.json(), async (req, res) => {
    const input = req.is('application/json') ? parsePurchaseBody(req.body) : null;
    if (!input) return sendError(res, 422, 'invalid_request');

    const result = await purchaseTicket({ eventId: req.params.eventId, ...input, channel: 'partner' });
    if (result.ok) {
      const { id, code, status } = result.ticket;
      return res.status(202).json({ ticketId: id, code, status }); // pendente, sem esperar o gateway (R06)
    }
    const failure = PURCHASE_ERRORS[result.error];
    if (!failure) throw new Error(`purchaseTicket: erro inesperado ${result.error}`);
    return sendError(res, failure.status, failure.error);
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
