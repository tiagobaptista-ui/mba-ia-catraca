import express from 'express';
import { requireRole } from '../../core/auth.js';
import { addManagementSection, loadOwnedEvent, renderManagementPage } from '../events/extensions.js';
import { normalizeTicketCode } from '../sales/service.js';
import { checkIn } from './service.js';
import { checkinSection } from './views.js';

// Check-in (F06): seção na página de gestão (ordem reservada 20, depois do painel) e o POST que valida o código.
export const SECTION_KEY = 'checkin';

addManagementSection({
  key: SECTION_KEY,
  order: 20,
  render: ({ event, result }) => checkinSection(event, result),
});

function codeFrom(body) {
  return normalizeTicketCode(body ? body.code : undefined);
}

function checkinRoutes() {
  const router = express.Router();
  // A guarda de papel de /organizer já vem de F01; repetida para a rota nunca ficar exposta sem ela (R13).
  router.use(requireRole('organizer'));

  // Só o organizador dono (loadOwnedEvent → 404 sem dados para outro organizador, R13). Responde 200 com a página
  // de gestão e o resultado de R10 na seção de check-in.
  router.post('/events/:id/checkin', loadOwnedEvent, async (req, res) => {
    const code = codeFrom(req.body);
    const { key, message } = await checkIn(req.event.id, code);
    await renderManagementPage(req, res, req.event, { results: { [SECTION_KEY]: { key, message, code } } });
  });

  return router;
}

export default {
  name: 'checkin',
  order: 60,
  register(app) {
    app.use('/organizer', checkinRoutes());
  },
};
