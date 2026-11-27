import express from 'express';
import { sendPage } from '../../core/layout.js';
import { requireRole } from '../../core/auth.js';
import {
  createEvent,
  updateEvent,
  publishEvent,
  getEvent,
  isOnSale,
  listOrganizerEvents,
  listOnSaleEvents,
} from './service.js';
import {
  addManagementSection,
  loadOwnedEvent,
  renderManagementPage,
  renderEventPage,
  renderStorefrontExtras,
  sendEventNotFound,
} from './extensions.js';
import {
  detailsSection,
  publishSection,
  editSection,
  formValuesFromInput,
  newEventBody,
  organizerListBody,
  storefrontBody,
} from './views.js';

// Avisos fixos exibidos na página de gestão depois de um POST bem-sucedido (?aviso=<chave>).
const NOTICES = { atualizado: 'Evento atualizado.', publicado: 'Evento publicado.' };

function noticeFrom(query) {
  const key = query && typeof query.aviso === 'string' ? query.aviso : '';
  return Object.hasOwn(NOTICES, key) ? NOTICES[key] : null;
}

// Seções nativas da página de gestão (R04). Outras features usam as ordens reservadas 10, 20 e 90.
addManagementSection({ key: 'details', order: 0, render: ({ event }) => detailsSection(event) });
addManagementSection({ key: 'publish', order: 40, render: ({ event, result }) => publishSection(event, result || {}) });
addManagementSection({ key: 'edit', order: 50, render: ({ event, result }) => editSection(event, result || {}) });

const notFoundInOrganizerArea = { backHref: '/organizer', backLabel: 'Voltar à área do organizador' };

function storefrontRoutes() {
  const router = express.Router();

  // Vitrine: só eventos à venda (R02).
  router.get('/', async (req, res) => {
    const events = await listOnSaleEvents();
    const cards = await Promise.all(
      events.map(async (event) => ({ event, extras: await renderStorefrontExtras(event, { variant: 'card', req }) })),
    );
    sendPage(res, { title: 'Vitrine', user: req.user, body: storefrontBody(cards) });
  });

  // Página pública: evento fora de venda (rascunho, cancelado, inexistente) → 404 (R02).
  router.get('/events/:id', async (req, res) => {
    const event = await getEvent(req.params.id);
    if (!isOnSale(event)) return sendEventNotFound(req, res);
    return renderEventPage(req, res, event);
  });

  return router;
}

// Área do organizador, montada em /organizer. A guarda de papel já é aplicada por accounts (F01);
// repetida aqui para que as rotas de F02 nunca fiquem expostas sem ela (R13).
function organizerRoutes() {
  const router = express.Router();
  router.use(requireRole('organizer'));

  router.get('/', async (req, res) => {
    const events = await listOrganizerEvents(req.user.id);
    sendPage(res, { title: 'Área do organizador', user: req.user, body: organizerListBody(events) });
  });

  router.get('/events/new', (req, res) => {
    sendPage(res, { title: 'Novo evento', user: req.user, body: newEventBody() });
  });

  // Criar: nasce rascunho (R01, R02).
  router.post('/events', async (req, res) => {
    const input = req.body || {};
    const result = await createEvent(req.user.id, input);
    if (result.event) return res.redirect(302, `/organizer/events/${result.event.id}`);
    return sendPage(res, {
      status: 422,
      title: 'Novo evento',
      user: req.user,
      body: newEventBody({ values: formValuesFromInput(input), errors: result.errors }),
    });
  });

  // Página de gestão com endereço próprio (R04).
  router.get('/events/:id', loadOwnedEvent, async (req, res) => {
    await renderManagementPage(req, res, req.event, { notice: noticeFrom(req.query) });
  });

  // Editar (R01 data futura, R03 capacity guard, R11 cancelado bloqueado).
  router.post('/events/:id', loadOwnedEvent, async (req, res) => {
    const input = req.body || {};
    const result = await updateEvent(req.user.id, req.event.id, input);
    if (result.notFound) return sendEventNotFound(req, res, notFoundInOrganizerArea);
    if (result.event) return res.redirect(302, `/organizer/events/${result.event.id}?aviso=atualizado`);
    return renderManagementPage(req, res, req.event, {
      status: result.status,
      results: { edit: { errors: result.errors, values: formValuesFromInput(input) } },
    });
  });

  // Publicar: só rascunho (R02); cancelado não é republicado (R11).
  router.post('/events/:id/publish', loadOwnedEvent, async (req, res) => {
    const result = await publishEvent(req.user.id, req.event.id);
    if (result.notFound) return sendEventNotFound(req, res, notFoundInOrganizerArea);
    if (result.event) return res.redirect(302, `/organizer/events/${result.event.id}?aviso=publicado`);
    return renderManagementPage(req, res, req.event, {
      status: result.status,
      results: { publish: { errors: result.errors } },
    });
  });

  return router;
}

export default {
  name: 'events',
  order: 20,
  register(app) {
    app.use(storefrontRoutes());
    app.use('/organizer', organizerRoutes());
  },
};
