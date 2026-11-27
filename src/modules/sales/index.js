import express from 'express';
import { html } from '../../core/html.js';
import { sendPage } from '../../core/layout.js';
import { requireRole } from '../../core/auth.js';
import { getEvent, isOnSale } from '../events/service.js';
import { addStorefrontExtra, renderEventPage, sendEventNotFound, setCapacityGuard } from '../events/extensions.js';
import { onGatewayResponse } from '../gateway/index.js';
import {
  MESSAGES,
  applyGatewayResponse,
  capacityGuard,
  getSeatAvailability,
  listUserTickets,
  purchaseTicket,
} from './service.js';
import { eventPageExtra, myTicketsBody, storefrontCardExtra } from './views.js';

// Integrações de F04, registradas uma única vez, ao carregar o módulo (o ESM guarda o módulo em cache):
//   - handler do gateway: aprovado → confirmado, recusado → recusado, só se o ingresso ainda estiver pendente (R08, R11);
//   - capacity guard de F02: lotação nunca menor que as vagas ocupadas (R03);
//   - extra da vitrine e da página pública: vagas, compra e "Ingressos esgotados" (R05, R07).
onGatewayResponse(applyGatewayResponse);
setCapacityGuard(capacityGuard);

export const STOREFRONT_EXTRA_KEY = 'sales';

addStorefrontExtra({
  key: STOREFRONT_EXTRA_KEY,
  order: 10,
  render: async ({ event, user, variant, result }) => {
    const availability = await getSeatAvailability(event.id);
    const available = availability ? availability.available : 0;
    if (variant === 'card') return storefrontCardExtra({ available });
    return eventPageExtra({ event, user, available, result });
  },
});

// Aviso de uma requisição só ("Compra registrada…"), em cookie curto: o redirect da compra fica exatamente
// /my-tickets e o aviso some no primeiro carregamento.
const NOTICE_COOKIE = 'catraca_aviso';
const NOTICE_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', path: '/my-tickets' };
const NOTICES = { compra: MESSAGES.purchased };

function setNotice(res, key) {
  res.cookie(NOTICE_COOKIE, key, { ...NOTICE_COOKIE_OPTIONS, maxAge: 60_000 });
}

function takeNotice(req, res) {
  const match = new RegExp(`(?:^|;\\s*)${NOTICE_COOKIE}=([^;]*)`).exec(req.headers.cookie || '');
  if (!match) return null;
  res.clearCookie(NOTICE_COOKIE, NOTICE_COOKIE_OPTIONS);
  return Object.hasOwn(NOTICES, match[1]) ? NOTICES[match[1]] : null;
}

function cardNumberFrom(body) {
  const value = body ? body.cardNumber : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function salesRoutes() {
  const router = express.Router();

  // Compra pela vitrine (participante). Visitante → login com retorno à página do evento; organizador → 403.
  router.post('/events/:id/purchase', async (req, res) => {
    const user = req.user;
    if (!user) return res.redirect(302, `/login?next=/events/${encodeURIComponent(req.params.id)}`);
    if (user.role !== 'participant') {
      return sendPage(res, {
        status: 403,
        title: 'Acesso restrito',
        user,
        body: html`<h1>Acesso restrito</h1><p>Organizadores não compram ingressos.</p>`,
      });
    }

    const event = await getEvent(req.params.id);
    if (!isOnSale(event)) return sendEventNotFound(req, res); // inexistente, rascunho ou cancelado (R02)

    const result = await purchaseTicket({
      eventId: event.id,
      cardNumber: cardNumberFrom(req.body),
      buyerEmail: user.email,
      userId: user.id,
      channel: 'storefront',
    });
    if (result.ok) {
      setNotice(res, 'compra');
      return res.redirect(302, '/my-tickets'); // R06: responde sem esperar o gateway
    }
    if (result.error === 'event_not_available') return sendEventNotFound(req, res);
    // sold_out → 409 "Ingressos esgotados" (R07); invalid_card → 422 (R06), sem ingresso criado.
    return renderEventPage(req, res, event, {
      status: result.error === 'sold_out' ? 409 : 422,
      results: { [STOREFRONT_EXTRA_KEY]: { error: result.error } },
    });
  });

  // "Meus ingressos" (R09): só os ingressos do participante logado.
  router.get('/my-tickets', requireRole('participant'), async (req, res) => {
    const notice = takeNotice(req, res);
    const tickets = await listUserTickets(req.user.id);
    sendPage(res, { title: 'Meus ingressos', user: req.user, body: myTicketsBody(tickets, { notice }) });
  });

  return router;
}

export default {
  name: 'sales',
  order: 40,
  register(app) {
    app.use(salesRoutes());
  },
};
