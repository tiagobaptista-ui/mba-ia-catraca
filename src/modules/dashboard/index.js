import { addManagementSection } from '../events/extensions.js';
import { getDashboard } from './service.js';
import { dashboardSection } from './views.js';

export { getDashboard } from './service.js';

// Seção "Painel" da página de gestão (R04, R12), na ordem reservada 10 (topo, logo depois dos dados do evento).
// A página de gestão de F02 já é só do organizador dono (loadOwnedEvent → 404 para os outros, R13), então o painel
// não tem rota própria. Registrada uma única vez, ao carregar o módulo (o ESM guarda o módulo em cache).
export const DASHBOARD_SECTION_KEY = 'dashboard';

addManagementSection({
  key: DASHBOARD_SECTION_KEY,
  order: 10,
  render: async ({ event }) => {
    const dashboard = await getDashboard(event);
    return dashboard ? dashboardSection(dashboard) : null;
  },
});

export default {
  name: 'dashboard',
  order: 80,
  register() {
    // sem rotas: o painel é uma seção da página de gestão de F02
  },
};
