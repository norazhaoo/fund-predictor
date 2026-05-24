import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildRefreshProgress,
  carryForwardBenchmarkQuotes,
  mergeNewerOfficialNav,
  predictLiveQuote,
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

test('browser app labels official NAV fields as confirmed values', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /确认净值/);
  assert.match(js, /确认日期/);
  assert.doesNotMatch(js, />最新净值</);
  assert.doesNotMatch(js, /净值日期：/);
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

test('browser app shows benchmark factor details on fund cards', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /参考指数/);
  assert.match(js, /指数修正/);
});

test('browser app renders compact expandable fund cards', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  const css = await readFile('assets/app.css', 'utf8');

  assert.match(js, /expandedCodes:\s*new Set\(\)/);
  assert.match(js, /function toggleFundCard/);
  assert.match(js, /class="fund-summary-button"/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /class="fund-detail"/);
  assert.match(css, /\.fund-summary-button\s*{/);
  assert.match(css, /\.compact-grid\s*{/);
  assert.match(css, /\.fund-detail\s*{/);
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

test('live ranking keeps newer official NAV from the previous complete snapshot', () => {
  const merged = mergeNewerOfficialNav([
    { code: '019633', navDate: '2026-05-21', nav: 2.5095, estimatedNav: 2.5348 },
  ], [
    {
      code: '019633',
      navDate: '2026-05-22',
      nav: 2.5314,
      officialChangePct: 0.87,
      officialNavSource: 'fundf10.eastmoney.com',
    },
  ]);

  assert.equal(merged[0].navDate, '2026-05-22');
  assert.equal(merged[0].nav, 2.5314);
  assert.equal(merged[0].estimatedNav, 2.5348);
  assert.equal(merged[0].officialNavSource, 'fundf10.eastmoney.com');
});

test('browser live prediction also applies benchmark divergence adjustment', () => {
  const prediction = predictLiveQuote({
    code: '019633',
    navDate: '2026-05-25',
    nav: 2,
    estimatedNav: 2.1,
    estimatedChangePct: 2,
    quoteTime: '2026-05-25 14:30',
    benchmark: { secid: '1.000688', name: '科创50', changePct: 4 },
    benchmarkSensitivity: 0.05,
  }, [], '2026-05-25');

  assert.equal(prediction.benchmarkAdjustment, 0.002);
  assert.equal(prediction.predictedNav, 2.102);
});

test('browser refresh carries forward previous benchmark quote into catalog funds', () => {
  const funds = carryForwardBenchmarkQuotes([
    { code: '019633', benchmark: { secid: '1.000688', name: '科创50', sensitivity: 0.05 } },
  ], [
    {
      code: '019633',
      benchmark: { secid: '1.000688', name: '科创50', changePct: 1.51, sensitivity: 0.05 },
      benchmarkSensitivity: 0.05,
    },
  ]);

  assert.equal(funds[0].benchmark.changePct, 1.51);
  assert.equal(funds[0].benchmarkSensitivity, 0.05);
});
