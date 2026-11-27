import express from 'express';
import { html } from '../../core/html.js';
import { sendPage } from '../../core/layout.js';
import { createSession, destroySession, requireRole } from '../../core/auth.js';
import { validateSignup, createParticipant, authenticate } from './service.js';

function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return html`<ul class="error">${errors.map((e) => html`<li>${e}</li>`)}</ul>`;
}

function signupForm({ values = {}, errors = [] } = {}) {
  return html`<h1>Criar conta</h1>
    <p class="muted">Conta de participante, para comprar ingressos.</p>
    ${errorList(errors)}
    <form method="post" action="/signup">
      <label for="name">Nome</label>
      <input id="name" name="name" value="${values.name || ''}" required>
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" value="${values.email || ''}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" minlength="6" required>
      <p><button type="submit">Criar conta</button></p>
    </form>
    <p>Já tem conta? <a href="/login">Entrar</a></p>`;
}

// Só aceita retorno para caminho local (evita open redirect).
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

function loginForm({ email = '', next = '', errors = [] } = {}) {
  return html`<h1>Entrar</h1>
    ${errorList(errors)}
    <form method="post" action="/login">
      <input type="hidden" name="next" value="${next}">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" value="${email}" required>
      <label for="password">Senha</label>
      <input id="password" name="password" type="password" required>
      <p><button type="submit">Entrar</button></p>
    </form>
    <p>Não tem conta? <a href="/signup">Criar conta</a></p>`;
}

export default {
  name: 'accounts',
  order: 10,
  register(app) {
    const router = express.Router();

    router.get('/signup', (req, res) => {
      sendPage(res, { title: 'Criar conta', user: req.user, body: signupForm() });
    });

    router.post('/signup', async (req, res) => {
      const { values, errors } = validateSignup(req.body || {});
      if (errors.length === 0) {
        const user = await createParticipant(values);
        if (user) {
          await createSession(res, user.id);
          return res.redirect(302, '/');
        }
        errors.push('E-mail já cadastrado.');
      }
      return sendPage(res, { status: 422, title: 'Criar conta', user: req.user, body: signupForm({ values, errors }) });
    });

    router.get('/login', (req, res) => {
      sendPage(res, { title: 'Entrar', user: req.user, body: loginForm({ next: safeNext(req.query.next) || '' }) });
    });

    router.post('/login', async (req, res) => {
      const body = req.body || {};
      const user = await authenticate(body.email, body.password);
      if (!user) {
        return sendPage(res, {
          status: 401,
          title: 'Entrar',
          user: req.user,
          body: loginForm({ email: body.email || '', next: safeNext(body.next) || '', errors: ['E-mail ou senha inválidos.'] }),
        });
      }
      await createSession(res, user.id);
      const fallback = user.role === 'organizer' ? '/organizer' : '/';
      return res.redirect(302, safeNext(body.next) || fallback);
    });

    router.post('/logout', async (req, res) => {
      await destroySession(req, res);
      res.redirect(302, '/');
    });

    app.use(router);

    // Área do organizador: a guarda vale para /organizer e todas as sub-rotas, qualquer que seja o módulo
    // que as monte (R13: participante e visitante não acessam).
    app.use('/organizer', requireRole('organizer'));
  },
};
