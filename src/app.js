import express from 'express';
import { html } from './core/html.js';
import { sendPage } from './core/layout.js';
import { loadUser } from './core/auth.js';
import { query } from './core/db.js';
import { config } from './core/config.js';

// Monta o app HTTP com os módulos já carregados (ver core/modules.js).
export function createApp(modules) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  if (config.logRequests) {
    app.use((req, _res, next) => {
      console.log(`[http] ${req.method} ${req.originalUrl}`);
      next();
    });
  }

  app.get('/healthz', async (_req, res) => {
    await query('SELECT 1');
    res.type('text').send('ok');
  });

  // Formulários HTML. JSON fica a cargo de cada módulo (a API de parceiros valida a chave antes do corpo).
  app.use(express.urlencoded({ extended: false }));
  app.use(loadUser);

  for (const mod of modules) mod.register(app);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
    return sendPage(res, {
      status: 404,
      title: 'Página não encontrada',
      user: req.user,
      body: html`<h1>Página não encontrada</h1><p><a href="/">Voltar à vitrine</a></p>`,
    });
  });

  app.use((err, req, res, _next) => {
    console.error('[http] erro', req.method, req.originalUrl, err);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'internal_error' });
    return sendPage(res, {
      status: 500,
      title: 'Erro',
      user: req.user,
      body: html`<h1>Algo deu errado</h1><p>Tente de novo em instantes.</p>`,
    });
  });

  return app;
}
