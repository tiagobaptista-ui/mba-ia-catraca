import express from 'express';
import { requireRole } from '../../core/auth.js';
import {
  addManagementSection,
  loadOwnedEvent,
  renderManagementPage,
  sendEventNotFound,
} from '../events/extensions.js';
import { cancelEvent, cancelledMessage } from './service.js';
import { cancelSection } from './views.js';

// F07: seção "Cancelamento" na página de gestão (ordem reservada 90) e POST /organizer/events/:id/cancel (R11, R13).
export const SECTION_KEY = 'cancel';

addManagementSection({
  key: SECTION_KEY,
  order: 90,
  render: ({ event, result }) => cancelSection(event, result || {}),
});

const notFoundInOrganizerArea = { backHref: '/organizer', backLabel: 'Voltar à área do organizador' };

function cancellationRoutes() {
  const router = express.Router();

  // Sucesso → 200 com a página de gestão do evento já cancelado (sem edição nem botão de cancelar) e o resultado;
  // rascunho ou já cancelado → 409 com a mensagem; outro organizador → 404 sem dados (loadOwnedEvent, R13).
  // A guarda de papel já vale para /organizer (accounts, F01); repetida aqui para a rota nunca ficar exposta.
  router.post('/events/:id/cancel', requireRole('organizer'), loadOwnedEvent, async (req, res) => {
    const result = await cancelEvent(req.user.id, req.event.id);
    if (result.notFound) return sendEventNotFound(req, res, notFoundInOrganizerArea);
    if (result.errors) {
      return renderManagementPage(req, res, result.event, {
        status: result.status,
        results: { [SECTION_KEY]: { errors: result.errors } },
      });
    }
    return renderManagementPage(req, res, result.event, {
      results: { [SECTION_KEY]: { notice: cancelledMessage(result) } },
    });
  });

  return router;
}

export default {
  name: 'cancellation',
  order: 70,
  register(app) {
    app.use('/organizer', cancellationRoutes());
  },
};
