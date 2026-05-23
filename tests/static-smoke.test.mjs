import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index references the dashboard assets and root element', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /<main id="app"/);
  assert.match(html, /assets\/app\.css/);
  assert.match(html, /assets\/app\.js/);
});

test('browser app loads latest and history JSON with relative paths', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /loadJson\('data\/latest\.json'/);
  assert.match(js, /loadJson\('data\/history\.json'/);
});

test('browser app does not use estimated change as a predicted-change fallback', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.doesNotMatch(js, /fund\.estimatedChangePct/);
});

test('browser app shares the investment disclaimer across render paths', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /function disclaimerNotice\(\)/);
  assert.match(js, /不构成投资建议/);
});

test('dynamic dashboard text wraps within mobile cards', async () => {
  const css = await readFile('assets/app.css', 'utf8');
  const dynamicClasses = [
    'fund-name',
    'fund-code',
    'message',
    'history-card',
    'notice',
  ];

  for (const className of dynamicClasses) {
    const rule = new RegExp(`\\.${className}\\s*{[^}]*min-width:\\s*0;[^}]*overflow-wrap:\\s*anywhere;`, 's');
    assert.match(css, rule);
  }

  assert.match(css, /\.history-card \.name,[\s\S]*\.history-card \.date,[\s\S]*\.history-card \.error\s*{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
});
