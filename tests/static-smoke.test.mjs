import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildRefreshProgress,
  shouldPublishLiveRanking,
  sortFundsForView,
} from '../assets/live-quotes.js';

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
  assert.match(js, /loadJson\('data\/funds\.json'/);
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

test('browser app wires full refresh progress and ranking controls', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  const live = await readFile('assets/live-quotes.js', 'utf8');
  assert.match(js, /refreshFundsInBatches/);
  assert.match(js, /createJsonpQuoteFetcher/);
  assert.match(js, /sortFundsForView/);
  assert.match(`${js}\n${live}`, /正在全量刷新/);
  assert.match(js, /id="sortKey"/);
  assert.match(js, /id="fundSearch"/);
  assert.match(js, /id="fundFilter"/);
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

test('live ranking waits for full batch completion before publishing sorted replacement', () => {
  const progress = buildRefreshProgress({ completed: 2, total: 4, failed: 0 });
  assert.equal(progress.text, '正在全量刷新：2/4');
  assert.equal(shouldPublishLiveRanking(progress), false);

  const done = buildRefreshProgress({ completed: 4, total: 4, failed: 0 });
  assert.equal(done.text, '全量刷新完成：4/4');
  assert.equal(shouldPublishLiveRanking(done), true);

  const allFailed = buildRefreshProgress({ completed: 4, total: 4, failed: 4 });
  assert.equal(shouldPublishLiveRanking(allFailed), false);
});

test('live ranking sorts by predicted change and keeps failures at the end', () => {
  const sorted = sortFundsForView([
    { code: 'fail', status: 'error', predictedChangePct: 99 },
    { code: 'low', status: 'ok', predictedChangePct: -1.2 },
    { code: 'high', status: 'ok', predictedChangePct: 3.4 },
    { code: 'stale', status: 'stale', predictedChangePct: 6.6 },
  ], { sortKey: 'predictedChangePct', direction: 'desc', query: '', filter: 'all' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['high', 'low', 'stale', 'fail']);
});

test('live ranking filters by search text and holding state', () => {
  const sorted = sortFundsForView([
    { code: '019633', name: '国泰半导体设备ETF联接C', holding: false, status: 'ok', predictedChangePct: 1 },
    { code: '016874', name: '广发远见智选混合C', holding: true, status: 'ok', predictedChangePct: 2 },
  ], { sortKey: 'predictedChangePct', direction: 'desc', query: '广发', filter: 'holding' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['016874']);
});
