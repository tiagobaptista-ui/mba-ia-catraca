import { createHash } from 'node:crypto';

// Layout fluido da Catraca, com azul e roxo como base.
// - Larguras, espaçamentos e tipografia escalam com a tela via clamp()/min(): sem pontos de quebra fixos para o
//   essencial; as grades (vitrine, página de gestão, painel) se reorganizam sozinhas com auto-fit/auto-fill.
// - Tokens em :root; o modo escuro (prefers-color-scheme) só troca os tokens.
// - Nada aqui muda textos ou marcadores data-* lidos pelos testes e pelo Fluxo do avaliador.
export const STYLE = `
  :root {
    color-scheme: light;
    --blue-300: #93c5fd; --blue-500: #3b82f6; --blue-600: #2563eb; --blue-700: #1d4ed8; --blue-800: #1e40af;
    --purple-300: #c4b5fd; --purple-500: #8b5cf6; --purple-600: #7c3aed; --purple-700: #6d28d9; --purple-800: #5b21b6;

    --bg: #f4f5ff;
    --surface: #ffffff;
    --surface-2: #f1effe;
    --text: #1c1a3a;
    --text-muted: #5d5b7d;
    --border: #e0ddf7;
    --link: var(--blue-700);
    --link-hover: var(--purple-700);
    --heading: linear-gradient(120deg, var(--blue-700), var(--purple-700));
    --brand: linear-gradient(120deg, var(--blue-700) 0%, var(--purple-700) 100%);
    --soft: linear-gradient(135deg, rgb(37 99 235 / .08), rgb(124 58 237 / .12));
    --chip-blue: rgb(37 99 235 / .10);
    --focus: 0 0 0 3px rgb(124 58 237 / .35);
    --ok: #047857; --ok-bg: #e7f7ef;
    --warn: #8a5300; --warn-bg: #fff4dc;
    --bad: #b42318; --bad-bg: #fdecea;
    --shadow: 0 1px 2px rgb(30 27 75 / .06), 0 14px 32px -18px rgb(76 29 149 / .40);
    --shadow-hover: 0 2px 4px rgb(30 27 75 / .08), 0 22px 44px -20px rgb(76 29 149 / .55);

    --max: 76rem;
    --gutter: clamp(1rem, .6rem + 2vw, 2.5rem);
    --gap: clamp(.9rem, .6rem + 1.2vw, 1.6rem);
    --pad: clamp(1rem, .75rem + 1vw, 1.75rem);
    --radius: clamp(.8rem, .65rem + .5vw, 1.15rem);
    --radius-sm: .65rem;
    --step--1: clamp(.82rem, .79rem + .15vw, .9rem);
    --step-0: clamp(1rem, .96rem + .2vw, 1.08rem);
    --step-1: clamp(1.15rem, 1.05rem + .5vw, 1.4rem);
    --step-2: clamp(1.35rem, 1.15rem + 1vw, 1.9rem);
    --step-3: clamp(1.75rem, 1.3rem + 2.2vw, 2.8rem);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0d0b22;
      --surface: #16143a;
      --surface-2: #1f1b4b;
      --text: #ecebff;
      --text-muted: #a8a5d0;
      --border: #2d2964;
      --link: var(--blue-300);
      --link-hover: var(--purple-300);
      --heading: linear-gradient(120deg, var(--blue-300), var(--purple-300));
      --soft: linear-gradient(135deg, rgb(59 130 246 / .14), rgb(139 92 246 / .18));
      --chip-blue: rgb(59 130 246 / .18);
      --focus: 0 0 0 3px rgb(167 139 250 / .45);
      --ok: #6ee7b7; --ok-bg: rgb(16 185 129 / .14);
      --warn: #fcd34d; --warn-bg: rgb(245 158 11 / .14);
      --bad: #fca5a5; --bad-bg: rgb(239 68 68 / .15);
      --shadow: 0 1px 2px rgb(0 0 0 / .45), 0 16px 40px -22px rgb(0 0 0 / .8);
      --shadow-hover: 0 2px 4px rgb(0 0 0 / .5), 0 24px 48px -22px rgb(91 33 182 / .6);
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }

  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    /* coluna travada na largura da tela: conteúdo largo (tabela) rola por dentro, sem alargar a página */
    grid-template-columns: minmax(0, 1fr);
    font: 400 var(--step-0)/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    color: var(--text);
    background:
      radial-gradient(60rem 32rem at -10% -12%, rgb(37 99 235 / .13), transparent 62%),
      radial-gradient(52rem 30rem at 110% -6%, rgb(124 58 237 / .15), transparent 62%),
      var(--bg);
    background-attachment: fixed;
  }

  /* ---- Cabeçalho: faixa azul → roxo de ponta a ponta, conteúdo alinhado ao container ---- */
  body > header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .5rem 1rem;
    padding: clamp(.7rem, .55rem + .6vw, 1.1rem) max(var(--gutter), calc((100% - var(--max)) / 2));
    background: var(--brand);
    color: #fff;
    box-shadow: 0 12px 30px -20px rgb(76 29 149 / .9);
  }
  header .brand {
    display: inline-flex;
    align-items: center;
    gap: .55rem;
    margin-right: auto;
    color: #fff;
    font-size: var(--step-1);
    font-weight: 800;
    letter-spacing: -.01em;
    text-decoration: none;
  }
  header .brand::before {
    content: "";
    inline-size: 1.45em;
    block-size: 1em;
    border: 2px solid #fff;
    border-left-style: dashed;
    border-radius: .3em;
    background: rgb(255 255 255 / .18);
  }
  header nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .25rem .4rem;
  }
  header nav a {
    color: #fff;
    text-decoration: none;
    font-weight: 500;
    padding: .4rem .8rem;
    border-radius: 999px;
    transition: background-color .15s;
  }
  header nav a:hover, header nav a:focus-visible { background: rgb(255 255 255 / .18); color: #fff; outline: none; }
  header .muted { color: rgb(255 255 255 / .82); padding-inline: .4rem; }
  header form { display: inline; margin: 0; }
  header button {
    background: rgb(255 255 255 / .14);
    border: 1px solid rgb(255 255 255 / .45);
    box-shadow: none;
    padding: .35rem .95rem;
  }
  header button:hover { background: rgb(255 255 255 / .26); }

  /* ---- Conteúdo: container fluido ---- */
  main {
    width: min(100% - 2 * var(--gutter), var(--max));
    margin-inline: auto;
    padding-block: clamp(1.5rem, 1rem + 2.5vw, 3rem);
  }
  main > :first-child { margin-top: 0; }

  h1, h2, h3 { line-height: 1.2; letter-spacing: -.015em; margin: 0 0 .6em; }
  h1 {
    font-size: var(--step-3);
    font-weight: 800;
    background: var(--heading);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  h2 { font-size: var(--step-2); font-weight: 700; }
  p { margin: .6em 0; }

  a { color: var(--link); text-underline-offset: .2em; text-decoration-thickness: .08em; }
  a:hover { color: var(--link-hover); }

  .muted { color: var(--text-muted); }

  /* ---- Superfícies (painéis) ---- */
  main > form,
  main > section[data-section],
  main > article.event,
  .card {
    position: relative;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: var(--pad);
  }
  main > section[data-section]::before,
  main > article.event::before,
  .card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 4px;
    background: var(--brand);
  }
  main > form { max-width: 34rem; }
  section h2 { font-size: var(--step-1); }

  /* Página de gestão: as seções viram uma grade fluida (1, 2 ou 3 colunas conforme a largura). */
  main:has(> section[data-section]) {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
    gap: var(--gap);
    align-items: start;
  }
  main:has(> section[data-section]) > :not(section) { grid-column: 1 / -1; margin: 0; }
  main > section[data-section="edit"] { grid-column: 1 / -1; }

  /* ---- Vitrine: grade de cards ---- */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: var(--gap);
  }
  .card {
    display: flex;
    flex-direction: column;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .card:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }
  .card h2 { font-size: var(--step-1); margin: .2rem 0 .4rem; }
  .card h2 a { color: inherit; text-decoration: none; }
  .card h2 a:hover { color: var(--link-hover); }
  .card .extra { margin-top: auto; }

  /* ---- Listas de dados ---- */
  dl.event-facts, dl.event-details {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: .35rem 1rem;
    margin: .75rem 0;
  }
  dt { color: var(--text-muted); font-size: var(--step--1); }
  dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }

  /* Painel do evento: um card por métrica, em grade que se reorganiza sozinha. */
  dl.dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
    gap: .75rem;
    margin: .75rem 0;
  }
  dl.dashboard .metric {
    background: var(--soft);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: .75rem .9rem;
  }
  dl.dashboard dd {
    font-size: var(--step-2);
    font-weight: 800;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    background: var(--heading);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  /* ---- Tabelas (lista do organizador, Meus ingressos) ---- */
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  th, td { text-align: left; padding: .75rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th {
    font-size: var(--step--1);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-muted);
    background: var(--soft);
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--surface-2); }
  td[data-status] { font-weight: 600; white-space: nowrap; }
  td[data-status]::before {
    content: "";
    display: inline-block;
    inline-size: .55em;
    block-size: .55em;
    margin-right: .45em;
    border-radius: 50%;
    background: currentColor;
    vertical-align: .08em;
  }
  td[data-status="confirmed"] { color: var(--ok); }
  td[data-status="pending"] { color: var(--warn); }
  td[data-status="declined"], td[data-status="cancelled"] { color: var(--bad); }
  td[data-status="refunded"] { color: var(--purple-600); }
  @media (prefers-color-scheme: dark) { td[data-status="refunded"] { color: var(--purple-300); } }

  /* ---- Formulários e botões ---- */
  label { display: block; margin: .9rem 0 .35rem; font-weight: 600; font-size: var(--step--1); }
  input, select, textarea {
    width: 100%;
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: .65rem .8rem;
    transition: border-color .15s, box-shadow .15s;
  }
  @media (prefers-color-scheme: dark) { input, select, textarea { background: var(--surface-2); } }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--purple-500); box-shadow: var(--focus); }
  .event-form, .checkin-form { max-width: 40rem; }

  button {
    font: inherit;
    font-weight: 600;
    color: #fff;
    background: var(--brand);
    border: 0;
    border-radius: 999px;
    padding: .65rem 1.3rem;
    cursor: pointer;
    box-shadow: 0 10px 22px -12px rgb(76 29 149 / .75);
    transition: transform .12s ease, filter .12s ease, box-shadow .12s ease;
  }
  button:hover { filter: brightness(1.08); transform: translateY(-1px); }
  button:active { transform: translateY(0); }
  button:focus-visible { outline: none; box-shadow: var(--focus); }
  .cancel-form button {
    background: linear-gradient(120deg, #dc2626, #be123c);
    box-shadow: 0 10px 22px -12px rgb(190 18 60 / .7);
  }

  /* ---- Mensagens, selos e códigos ---- */
  .notice {
    padding: .85rem 1rem;
    border-radius: var(--radius-sm);
    background: var(--soft);
    border: 1px solid var(--border);
    border-left: 4px solid var(--purple-600);
  }
  .error {
    list-style: none;
    margin: .75rem 0;
    padding: .85rem 1rem;
    border-radius: var(--radius-sm);
    background: var(--bad-bg);
    color: var(--bad);
    border-left: 4px solid currentColor;
  }
  .error li + li { margin-top: .25rem; }

  .seats, .sold-out, .checkin-note {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    margin: .5rem 0;
    padding: .3rem .8rem;
    border-radius: 999px;
    font-size: var(--step--1);
    font-weight: 700;
  }
  .seats { background: var(--chip-blue); color: var(--link); }
  .sold-out, .checkin-note { background: var(--bad-bg); color: var(--bad); }

  .checkin-result {
    display: inline-flex;
    align-items: center;
    margin: .75rem 0 .25rem;
    padding: .65rem 1.1rem;
    border-radius: var(--radius-sm);
    font-size: var(--step-1);
    font-weight: 800;
    background: var(--bad-bg);
    color: var(--bad);
    border-left: 4px solid currentColor;
  }
  .checkin-result[data-result="released"] { background: var(--ok-bg); color: var(--ok); }
  .checkin-result[data-result="already_used"],
  .checkin-result[data-result="not_confirmed"] { background: var(--warn-bg); color: var(--warn); }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: .92em;
    letter-spacing: .08em;
    padding: .1rem .45rem;
    border-radius: .4rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  /* ---- Rodapé ---- */
  body > footer {
    padding: 1.25rem var(--gutter) 1.75rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--step--1);
    border-top: 1px solid var(--border);
  }

  /* ---- Telas estreitas ---- */
  @media (max-width: 44rem) {
    table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }
    main form button { width: 100%; }
    header nav { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; }
    .card:hover, button:hover { transform: none; }
  }
`;

// Servida como arquivo próprio (não embutida no HTML): as páginas ficam leves e os seletores do CSS
// (data-metric, data-result…) não aparecem no HTML — os testes de R13 conferem que uma página negada não
// traz nenhum desses marcadores. O hash no endereço invalida o cache quando o estilo muda.
export const STYLE_PATH = '/assets/catraca.css';
export const STYLE_VERSION = createHash('sha256').update(STYLE).digest('hex').slice(0, 10);
export const STYLE_HREF = `${STYLE_PATH}?v=${STYLE_VERSION}`;
