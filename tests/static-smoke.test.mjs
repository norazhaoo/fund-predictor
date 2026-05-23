import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index references the dashboard assets and root element', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /<main id="app"/);
  assert.match(html, /assets\/app\.css/);
  assert.match(html, /assets\/app\.js/);
});

test('browser app fetches latest and history JSON with relative paths', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /fetch\('data\/latest\.json'/);
  assert.match(js, /fetch\('data\/history\.json'/);
});
