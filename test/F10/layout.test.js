// Layout fluido (azul e roxo): folha de estilo servida à parte, páginas sem CSS embutido e marcação estável.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestApp, createClient, SEED } from '../helpers/index.js';
import { STYLE, STYLE_HREF, STYLE_PATH } from '../../src/core/style.js';

const app = useTestApp({ workers: false });

test('a folha de estilo é servida como CSS com o endereço versionado usado pelas páginas', async () => {
  const c = createClient(app.baseUrl);
  const res = await c.get(STYLE_HREF);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/css/);
  assert.equal(res.text, STYLE);
  assert.match(res.text, /--blue-600: #2563eb/);
  assert.match(res.text, /--purple-600: #7c3aed/);
  assert.match(res.text, /prefers-color-scheme: dark/);
  assert.equal((await c.get(STYLE_PATH)).status, 200, 'também responde sem o ?v=');
});

test('as páginas apontam para a folha de estilo e não embutem CSS (nenhum seletor data-* no HTML)', async () => {
  const visitor = createClient(app.baseUrl);
  const organizer = createClient(app.baseUrl);
  await organizer.login(SEED.organizerA);
  for (const res of [await visitor.get('/'), await visitor.get('/login'), await organizer.get('/organizer')]) {
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(`<link rel="stylesheet" href="${STYLE_HREF}">`));
    assert.doesNotMatch(res.text, /<style/);
    assert.match(res.text, /<main>/);
    assert.match(res.text, /<nav aria-label="Navegação principal">/);
  }
});
