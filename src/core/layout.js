import { html } from './html.js';
import { STYLE_HREF } from './style.js';

// Página completa com a navegação da Catraca. `body` deve ser um valor html``.
export function page({ title, user, body }) {
  const nav = html`
    <header>
      <a class="brand" href="/">Catraca</a>
      <nav aria-label="Navegação principal">
        <a href="/">Vitrine</a>
        ${user && user.role === 'participant' ? html`<a href="/my-tickets">Meus ingressos</a>` : ''}
        ${user && user.role === 'organizer' ? html`<a href="/organizer">Área do organizador</a>` : ''}
        ${user
          ? html`<span class="muted">${user.name}</span>
              <form method="post" action="/logout"><button type="submit">Sair</button></form>`
          : html`<a href="/login">Entrar</a> <a href="/signup">Criar conta</a>`}
      </nav>
    </header>`;
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#4338ca">
<title>${title} · Catraca</title>
<link rel="stylesheet" href="${STYLE_HREF}">
</head>
<body>
${nav}
<main>
${body}
</main>
<footer>Catraca · ingressos para shows, workshops e meetups</footer>
</body>
</html>`.toString();
}

// Atalho para responder com uma página.
export function sendPage(res, { status = 200, title, user, body }) {
  res.status(status).type('html').send(page({ title, user, body }));
}
