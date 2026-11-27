import { addStorefrontExtra, setCapacityGuard } from '../events/extensions.js';
import { onGatewayResponse } from '../gateway/index.js';
import { applyGatewayResponse, capacityGuard, getSeatAvailability } from './service.js';
import { eventPageExtra, storefrontCardExtra } from './views.js';

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

export default {
  name: 'sales',
  order: 40,
  register() {},
};
