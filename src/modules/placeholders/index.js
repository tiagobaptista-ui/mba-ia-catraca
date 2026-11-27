import { html } from '../../core/html.js';
import { sendPage } from '../../core/layout.js';

// Páginas provisórias de F01 (vitrine e início da área do organizador). Montadas por último (order 999):
// quando F02 monta GET / e GET /organizer, estas rotas deixam de ser alcançadas e o módulo pode ser removido.
export default {
  name: 'placeholders',
  order: 999,
  register(app) {
    app.get('/', (req, res) => {
      sendPage(res, {
        title: 'Vitrine',
        user: req.user,
        body: html`<h1>Vitrine</h1><p class="muted">Nenhum evento à venda no momento.</p>`,
      });
    });
    app.get('/organizer', (req, res) => {
      sendPage(res, {
        title: 'Área do organizador',
        user: req.user,
        body: html`<h1>Área do organizador</h1><p>Olá, ${req.user.name}.</p>`,
      });
    });
  },
};
