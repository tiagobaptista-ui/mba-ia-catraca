import { html, raw } from './html.js';

const STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 0 16px 48px; color: #1d1d1f; }
  header { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; border-bottom: 1px solid #ddd; padding: 12px 0; margin-bottom: 24px; }
  header .brand { font-weight: 700; font-size: 1.2rem; margin-right: auto; text-decoration: none; color: inherit; }
  header form { display: inline; margin: 0; }
  a { color: #0a58ca; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  label { display: block; margin: 8px 0 2px; }
  input, select { padding: 6px; font-size: 1rem; }
  button { padding: 6px 12px; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; }
  .notice { padding: 8px 12px; background: #eef6ff; border: 1px solid #b6d4fe; margin: 8px 0; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin: 12px 0; }
  .muted { color: #666; }
  section { margin: 24px 0; }
`;

// Página completa com a navegação da Catraca. `body` deve ser um valor html``.
export function page({ title, user, body }) {
  const nav = html`
    <header>
      <a class="brand" href="/">Catraca</a>
      <a href="/">Vitrine</a>
      ${user && user.role === 'participant' ? html`<a href="/my-tickets">Meus ingressos</a>` : ''}
      ${user && user.role === 'organizer' ? html`<a href="/organizer">Área do organizador</a>` : ''}
      ${user
        ? html`<span class="muted">${user.name}</span>
            <form method="post" action="/logout"><button type="submit">Sair</button></form>`
        : html`<a href="/login">Entrar</a> <a href="/signup">Criar conta</a>`}
    </header>`;
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Catraca</title>
<style>${raw(STYLE)}</style>
</head>
<body>
${nav}
<main>
${body}
</main>
</body>
</html>`.toString();
}

// Atalho para responder com uma página.
export function sendPage(res, { status = 200, title, user, body }) {
  res.status(status).type('html').send(page({ title, user, body }));
}
