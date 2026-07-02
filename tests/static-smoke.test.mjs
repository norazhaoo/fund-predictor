import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildRefreshProgress,
  applyBenchmarkQuotes,
  carryForwardBenchmarkQuotes,
  carryForwardQuoteSnapshot,
  createBenchmarkScriptFetcher,
  createJsonpQuoteFetcher,
  createOfficialNavScriptFetcher,
  mergeNewerOfficialNav,
  mergeRetriedFunds,
  proxyPredictionFor,
  predictLiveQuote,
  rateLimitedErrorFunds,
  refreshFundsInBatches,
  shouldPublishLiveRanking,
  sortFundsForView,
} from '../assets/live-quotes.js';

function tencentLine(symbol, code, price, quoteTime, change, changePct) {
  const fields = Array(33).fill('');
  fields[2] = code;
  fields[3] = String(price);
  fields[30] = quoteTime;
  fields[31] = String(change);
  fields[32] = String(changePct);
  return fields.join('~');
}

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

test('github action schedules one 14:10 China-time data refresh and commits generated JSON', async () => {
  const workflow = await readFile('.github/workflows/fund-data.yml', 'utf8');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.equal([...workflow.matchAll(/cron:/g)].length, 1);
  assert.match(workflow, /cron: '10 6 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '30 6 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '45 6 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '0 7 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '15 7 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '0 8 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '30 2 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '20 3 \* \* 1-5'/);
  assert.doesNotMatch(workflow, /cron: '50 5 \* \* 1-5'/);
  assert.match(workflow, /npm run update/);
  assert.match(workflow, /data\/latest\.json/);
  assert.match(workflow, /data\/history\.json/);
  assert.match(workflow, /data\/refresh-snapshots\.json/);
  assert.match(workflow, /git commit -m "data: update fund snapshots"/);
  await assert.rejects(
    readFile('.github/workflows/update-fund-data.yml', 'utf8'),
    { code: 'ENOENT' },
  );
});

test('project does not expose a local scheduled updater', async () => {
  const packageJson = await readFile('package.json', 'utf8');
  assert.doesNotMatch(packageJson, /scheduled-update/);
  await assert.rejects(
    readFile('scripts/scheduled-update.mjs', 'utf8'),
    { code: 'ENOENT' },
  );
});

test('browser app labels primary card values as unified estimates', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /function estimateNavValue/);
  assert.match(js, /function estimateChangeValue/);
  assert.match(js, /估算涨跌/);
  assert.match(js, /估算净值/);
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


test('browser app keeps refresh local and leaves quote fetching outside the UI', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /sortFundsForView/);
  assert.match(js, /async function reloadLocalData/);
  assert.match(js, /reloadLocalData\(\);/);
  assert.match(js, /点击刷新读取最新本地结果/);
  assert.doesNotMatch(js, /refreshFundsInBatches/);
  assert.doesNotMatch(js, /createJsonpQuoteFetcher/);
  assert.doesNotMatch(js, /createBenchmarkScriptFetcher/);
  assert.doesNotMatch(js, /createOfficialNavScriptFetcher/);
  assert.doesNotMatch(js, /window\.setInterval\(startFullRefresh/);
  assert.doesNotMatch(js, /function startFullRefresh/);
  assert.match(js, /id="sortKey"/);
  assert.match(js, /id="fundSearch"/);
  assert.match(js, /id="fundFilter"/);
});

test('browser app does not contain foreground quote pacing knobs', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.doesNotMatch(js, /const refreshConcurrency/);
  assert.doesNotMatch(js, /const refreshRequestSpacingMs/);
  assert.doesNotMatch(js, /const refreshRetryBackoffMs/);
  assert.doesNotMatch(js, /const backgroundRetryDelayMs/);
  assert.doesNotMatch(js, /const refreshIntervalMs/);
  assert.doesNotMatch(js, /requestSpacingMs:/);
  assert.doesNotMatch(js, /quoteMaxRetries:/);
  assert.doesNotMatch(js, /quoteRetryBackoffMs:/);
});

test('browser app has no foreground background-retry copy', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.doesNotMatch(js, /backgroundRetryText/);
  assert.doesNotMatch(js, /function scheduleBackgroundRetry/);
  assert.doesNotMatch(js, /async function runBackgroundRetry/);
  assert.doesNotMatch(js, /后台重试/);
});

test('browser app shows benchmark factor details on fund cards', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /参考指数/);
  assert.match(js, /指数修正/);
});

test('browser app keeps fund filters and sorts focused', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /groupFilter:\s*'all'/);
  assert.match(js, /function groupOptions/);
  assert.match(js, /id="fundGroupFilter"/);
  assert.match(js, /<span>板块<\/span>/);
  assert.match(js, /全部板块/);
  assert.match(js, /<option value="all"\$\{state\.filter === 'all' \? ' selected' : ''\}>全部<\/option>/);
  assert.match(js, /<option value="positive"\$\{state\.filter === 'positive' \? ' selected' : ''\}>上涨<\/option>/);
  assert.match(js, /<option value="negative"\$\{state\.filter === 'negative' \? ' selected' : ''\}>下跌<\/option>/);
  assert.match(js, /<option value="success"\$\{state\.filter === 'success' \? ' selected' : ''\}>成功<\/option>/);
  assert.match(js, /<option value="nonProxy"\$\{state\.filter === 'nonProxy' \? ' selected' : ''\}>非替代估算<\/option>/);
  assert.doesNotMatch(js, /<option value="holding"/);
  assert.doesNotMatch(js, /<option value="watching"/);
  assert.doesNotMatch(js, /<option value="proxy"/);
  assert.doesNotMatch(js, /<option value="error"/);
  assert.match(js, /<option value="predictedChangePct"\$\{state\.sortKey === 'predictedChangePct' \? ' selected' : ''\}>估算涨跌<\/option>/);
  assert.match(js, /<option value="nav"\$\{state\.sortKey === 'nav' \? ' selected' : ''\}>确认净值<\/option>/);
  assert.doesNotMatch(js, /<option value="estimatedChangePct"/);
  assert.doesNotMatch(js, /<option value="quoteTime"/);
  assert.doesNotMatch(js, /<option value="code"/);
  assert.doesNotMatch(js, /<option value="custom"/);
  assert.doesNotMatch(js, /proxy:\s*'替代估算'/);
  assert.doesNotMatch(js, /status === 'proxy' \? 'proxy'/);
  assert.doesNotMatch(js, /if \(fund\.status === 'proxy'\)[\s\S]*return '参考行情'/);

  const css = await readFile('assets/app.css', 'utf8');
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*72px\s*72px;/);
});

test('browser app updates search results without replacing the focused search input', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /function renderFundList\(\)/);
  assert.match(js, /const list = app\.querySelector\('\.fund-list'\);[\s\S]*list\.innerHTML = fundListHtml\(\);/);
  assert.match(js, /#fundSearch'\)\?\.addEventListener\('input', \(event\) => \{\n    state\.query = event\.currentTarget\.value;\n    renderFundList\(\);\n  \}\);/);
  assert.doesNotMatch(js, /#fundSearch'\)\?\.addEventListener\('input', \(event\) => \{\n    state\.query = event\.currentTarget\.value;\n    render\(\);\n  \}\);/);
});

test('browser app reports local data reload time separately from generated data time', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /lastLocalReloadAt:\s*''/);
  assert.match(js, /state\.lastLocalReloadAt = new Date\(\)\.toLocaleTimeString/);
  assert.doesNotMatch(js, /generatedAt: refreshedAt\.toISOString\(\)/);
  assert.doesNotMatch(js, /lastFullRefreshAt/);
});

test('browser app renders compact expandable fund cards', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  const css = await readFile('assets/app.css', 'utf8');

  assert.match(js, /expandedCodes:\s*new Set\(\)/);
  assert.match(js, /function toggleFundCard/);
  assert.match(js, /class="fund-summary-button"/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /class="fund-detail"/);
  assert.match(js, /<span class="label">估算涨跌<\/span>/);
  assert.match(js, /<span class="label">估算净值<\/span>/);
  assert.match(js, /<span class="label">时间<\/span>/);
  assert.match(js, /<span class="label">确认净值<\/span>/);
  assert.doesNotMatch(js, /<span class="label">预测涨跌<\/span>/);
  assert.doesNotMatch(js, /<span class="label">预测净值<\/span>/);
  assert.doesNotMatch(js, /<span class="label">估值涨跌<\/span>/);
  assert.match(css, /\.fund-summary-button\s*{/);
  assert.match(css, /\.compact-grid\s*{/);
  assert.match(css, /\.fund-detail\s*{/);
});

test('browser app exposes a trade radar view for short-cycle fund T signals', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  const css = await readFile('assets/app.css', 'utf8');

  assert.match(js, /sortTradeRadarFunds/);
  assert.match(js, /viewMode:\s*'estimate'/);
  assert.match(js, /tradeActionFilter:\s*'all'/);
  assert.match(js, /data-view-mode="trade"/);
  assert.match(js, /id="tradeActionFilter"/);
  assert.match(js, /T分数/);
  assert.match(js, /信号/);
  assert.match(js, /目标持有/);
  assert.match(js, /targetHoldingDays/);
  assert.match(js, /低吸观察/);
  assert.match(css, /\.view-tabs\s*{/);
  assert.match(css, /\.trade-score\s*{/);
  assert.match(css, /\.trade-reason-list\s*{/);
});

test('dynamic dashboard text wraps within mobile cards', async () => {
  const css = await readFile('assets/app.css', 'utf8');
  const dynamicClasses = [
    'fund-name',
    'fund-code',
    'message',
    'trade-reason-list',
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

  const progressWithFailure = buildRefreshProgress({ completed: 2, total: 4, failed: 1 });
  assert.equal(progressWithFailure.text, '正在全量刷新：1/4，失败 1 只，已完成 2/4');
  assert.equal(shouldPublishLiveRanking(progressWithFailure), false);

  const done = buildRefreshProgress({ completed: 4, total: 4, failed: 0 });
  assert.equal(done.text, '全量刷新完成：4/4');
  assert.equal(shouldPublishLiveRanking(done), true);

  const allFailed = buildRefreshProgress({ completed: 4, total: 4, failed: 4 });
  assert.equal(shouldPublishLiveRanking(allFailed), false);
});

test('live refresh spaces quote request starts to avoid rate caps', async () => {
  const starts = [];
  const sleeps = [];
  const funds = ['000001', '000002', '000003', '000004'].map((code, index) => ({
    code,
    fallbackName: `基金${index + 1}`,
  }));
  const refresh = refreshFundsInBatches({
    funds,
    tradingDate: '2026-05-25',
    concurrency: 3,
    requestSpacingMs: 500,
    sleep: () => new Promise((resolve) => sleeps.push(resolve)),
    fetchQuote: async (fund) => {
      starts.push(fund.code);
      return {
        code: fund.code,
        name: fund.fallbackName,
        navDate: '2026-05-22',
        nav: 1,
        estimatedNav: 1.01,
        estimatedChangePct: 1,
        quoteTime: '2026-05-25 14:30',
      };
    },
  });

  for (let index = 0; index < 10 && starts.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.deepEqual([...starts], ['000001']);

  let done = false;
  refresh.then(() => {
    done = true;
  });
  for (let index = 0; index < 10 && !done; index += 1) {
    while (sleeps.length) {
      sleeps.shift()();
    }
    await Promise.resolve();
    await Promise.resolve();
  }

  await refresh;
  assert.deepEqual([...starts], ['000001', '000002', '000003', '000004']);
});

test('live refresh retries rate-capped quote requests before marking them failed', async () => {
  const sleeps = [];
  let attempts = 0;
  const resultPromise = refreshFundsInBatches({
    funds: [{ code: '000001', fallbackName: '限频基金' }],
    tradingDate: '2026-05-25',
    quoteRetryBackoffMs: 3000,
    sleep: () => new Promise((resolve) => sleeps.push(resolve)),
    fetchQuote: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('估值请求失败：000001（可能触发接口频率限制）');
      }
      return {
        code: '000001',
        name: '限频基金',
        navDate: '2026-05-22',
        nav: 1,
        estimatedNav: 1.01,
        estimatedChangePct: 1,
        quoteTime: '2026-05-25 14:30',
      };
    },
  });

  await Promise.resolve();
  await Promise.resolve();
  for (let index = 0; index < 20 && sleeps.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(attempts, 1);
  assert.equal(sleeps.length, 1);
  sleeps.shift()();

  const result = await resultPromise;
  assert.equal(attempts, 2);
  assert.equal(result.progress.failed, 0);
  assert.equal(result.funds[0].status, 'ok');
});

test('live refresh pauses the shared request queue after a rate cap', async () => {
  const starts = [];
  const sleeps = [];
  const resultPromise = refreshFundsInBatches({
    funds: ['000001', '000002', '000003'].map((code) => ({ code, fallbackName: code })),
    tradingDate: '2026-05-25',
    concurrency: 2,
    requestSpacingMs: 0,
    quoteRetryBackoffMs: 3000,
    sleep: (ms) => new Promise((resolve) => sleeps.push({ ms, resolve })),
    fetchQuote: async (fund) => {
      starts.push(fund.code);
      if (fund.code === '000001' && starts.filter((code) => code === fund.code).length === 1) {
        throw new Error('估值请求失败：000001（可能触发接口频率限制）');
      }
      return {
        code: fund.code,
        name: fund.fallbackName,
        navDate: '2026-05-22',
        nav: 1,
        estimatedNav: 1.01,
        estimatedChangePct: 1,
        quoteTime: '2026-05-25 14:30',
      };
    },
  });

  for (let index = 0; index < 20 && (sleeps.length === 0 || starts.length < 2); index += 1) {
    await Promise.resolve();
  }
  assert.deepEqual([...starts], ['000001', '000002']);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0].ms, 3000);
  sleeps.shift().resolve();

  const result = await resultPromise;
  assert.equal(result.progress.failed, 0);
  assert.deepEqual(starts.toSorted(), ['000001', '000001', '000002', '000003']);
});

test('live refresh can keep foreground pass fast by deferring rate-cap retries', async () => {
  let attempts = 0;
  const result = await refreshFundsInBatches({
    funds: [{ code: '000001', fallbackName: '限频基金' }],
    tradingDate: '2026-05-25',
    quoteMaxRetries: 0,
    fetchQuote: async () => {
      attempts += 1;
      throw new Error('估值请求失败：000001（可能触发接口频率限制）');
    },
  });

  assert.equal(attempts, 1);
  assert.equal(result.progress.failed, 1);
  assert.equal(result.funds[0].status, 'error');
});

test('rate-limited errors can be selected and replaced by background retry results', () => {
  const current = [
    { code: '000001', status: 'error', message: 'HTTP 514 Frequency Capped' },
    { code: '000002', status: 'error', message: '普通失败' },
    { code: '000003', status: 'ok', predictedChangePct: 1 },
  ];
  const retryTargets = rateLimitedErrorFunds(current);

  assert.deepEqual(retryTargets.map((fund) => fund.code), ['000001']);
  assert.deepEqual(mergeRetriedFunds(current, [
    { code: '000001', status: 'ok', predictedChangePct: 2 },
  ]), [
    { code: '000001', status: 'ok', predictedChangePct: 2 },
    { code: '000002', status: 'error', message: '普通失败' },
    { code: '000003', status: 'ok', predictedChangePct: 1 },
  ]);
});

test('browser benchmark script fetcher reads Tencent quote globals', async () => {
  const windowRef = {
    setTimeout,
    clearTimeout,
  };
  let removed = false;
  const documentRef = {
    createElement: () => ({ remove() { removed = true; } }),
    head: {
      append(script) {
        assert.match(script.src, /^https:\/\/qt\.gtimg\.cn\/q=sh501029&_=\d+$/);
        setTimeout(() => {
          windowRef.v_sh501029 = tencentLine('sh501029', '501029', 1.827, '20260522161425', 0.004, 0.22);
          script.onload();
        }, 0);
      },
    },
  };
  const fetchBenchmarks = createBenchmarkScriptFetcher({
    documentRef,
    windowRef,
    now: () => 123,
  });

  const quotes = await fetchBenchmarks([
    { secid: '1.501029', name: '红利基金LOF', sensitivity: 0.05, proxySensitivity: 1 },
  ]);

  assert.equal(removed, true);
  assert.equal(quotes.get('1.501029').name, '红利基金LOF');
  assert.equal(quotes.get('1.501029').changePct, 0.22);
  assert.equal(quotes.get('1.501029').proxySensitivity, 1);
});

test('browser official NAV script fetcher reads Eastmoney F10 payloads', async () => {
  const windowRef = {
    setTimeout,
    clearTimeout,
  };
  const documentRef = {
    createElement: () => ({ remove() {} }),
    head: {
      append(script) {
        assert.match(script.src, /^https:\/\/fundf10\.eastmoney\.com\/F10DataApi\.aspx\?type=lsjz&code=005125&page=1&per=1&rt=123$/);
        setTimeout(() => {
          windowRef.apidata = {
            content: "<table><tbody><tr><td>2026-05-22</td><td class='tor bold'>1.7568</td><td>1.9102</td><td>-0.27%</td></tr></tbody></table>",
          };
          script.onload();
        }, 0);
      },
    },
  };
  const fetchOfficialNav = createOfficialNavScriptFetcher({
    documentRef,
    windowRef,
    now: () => 123,
  });

  const nav = await fetchOfficialNav({ code: '005125' });

  assert.equal(nav.code, '005125');
  assert.equal(nav.navDate, '2026-05-22');
  assert.equal(nav.nav, 1.7568);
  assert.equal(nav.officialChangePct, -0.27);
});

test('proxy prediction uses official NAV and benchmark quote when fund estimate is unavailable', () => {
  const prediction = proxyPredictionFor(
    {
      code: '005125',
      name: '华宝标普中国A股红利机会ETF联接（LOF）C',
      navDate: '2026-05-22',
      nav: 1.5,
      benchmark: {
        secid: '1.501029',
        name: '红利基金LOF',
        changePct: 0.22,
        quoteTime: '20260522161425',
        source: 'qt.gtimg.cn',
        proxySensitivity: 1,
      },
    },
    new Error('暂无估值数据：005125'),
  );

  assert.equal(prediction.status, 'proxy');
  assert.equal(prediction.predictedNav, 1.5033);
  assert.equal(prediction.predictedChangePct, 0.22);
  assert.equal(prediction.estimatedNav, null);
  assert.match(prediction.message, /替代估算/);
});

test('live refresh converts no-data quote errors into proxy predictions when possible', async () => {
  const funds = [{
    code: '005125',
    fallbackName: '华宝标普中国A股红利机会ETF联接（LOF）C',
    navDate: '2026-05-22',
    nav: 1.5,
    benchmark: {
      secid: '1.501029',
      name: '红利基金LOF',
      changePct: 0.22,
      quoteTime: '20260522161425',
      source: 'qt.gtimg.cn',
      proxySensitivity: 1,
    },
  }];

  const result = await refreshFundsInBatches({
    funds,
    tradingDate: '2026-05-25',
    fetchQuote: async () => {
      throw new Error('暂无估值数据：005125');
    },
  });

  assert.equal(result.progress.failed, 0);
  assert.equal(result.funds[0].status, 'proxy');
  assert.equal(result.funds[0].predictedChangePct, 0.22);
});

test('live refresh fetches official NAV for proxy fallback when snapshot has no NAV', async () => {
  const result = await refreshFundsInBatches({
    funds: [{
      code: '005125',
      fallbackName: '华宝标普中国A股红利机会ETF联接（LOF）C',
      benchmark: {
        secid: '1.501029',
        name: '红利基金LOF',
        changePct: 0.22,
        quoteTime: '20260522161425',
        source: 'qt.gtimg.cn',
        proxySensitivity: 1,
      },
    }],
    tradingDate: '2026-05-25',
    fetchQuote: async () => {
      throw new Error('暂无估值数据：005125');
    },
    fetchProxyBase: async () => ({
      navDate: '2026-05-22',
      nav: 1.7568,
      officialChangePct: -0.27,
      officialNavSource: 'fundf10.eastmoney.com',
    }),
  });

  assert.equal(result.progress.failed, 0);
  assert.equal(result.funds[0].status, 'proxy');
  assert.equal(result.funds[0].nav, 1.7568);
  assert.equal(result.funds[0].predictedNav, 1.7607);
});

test('jsonp fetcher rejects empty fund payload without waiting for timeout', async () => {
  const windowRef = {
    setTimeout,
    clearTimeout,
  };
  const documentRef = {
    createElement: () => ({ remove() {} }),
    head: {
      append(script) {
        setTimeout(() => {
          windowRef.jsonpgz();
          if (typeof script.onload === 'function') {
            script.onload();
          }
        }, 0);
      },
    },
  };
  const fetchQuote = createJsonpQuoteFetcher({
    documentRef,
    windowRef,
    timeoutMs: 1000,
    now: () => 1,
  });

  await assert.rejects(
    fetchQuote({ code: '005125', fallbackName: '华宝标普中国A股红利机会ETF联接（LOF）C' }),
    /暂无估值数据：005125/,
  );
});

test('live ranking sorts by predicted change and keeps failures at the end', () => {
  const sorted = sortFundsForView([
    { code: 'fail', status: 'error', predictedChangePct: 99 },
    { code: 'low', status: 'ok', predictedChangePct: -1.2 },
    { code: 'high', status: 'ok', predictedChangePct: 3.4 },
    { code: 'stale', status: 'stale', predictedChangePct: 6.6 },
  ], { sortKey: 'predictedChangePct', direction: 'desc', query: '', filter: 'all' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['stale', 'high', 'low', 'fail']);
});

test('live ranking sorts usable proxy and stale estimates with normal estimates', () => {
  const sorted = sortFundsForView([
    { code: 'ok-low', status: 'ok', predictedChangePct: 0.5 },
    { code: 'proxy-high', status: 'proxy', predictedChangePct: 2 },
    { code: 'stale-mid', status: 'stale', predictedChangePct: 1.2 },
    { code: 'fail-high', status: 'error', predictedChangePct: 9 },
  ], { sortKey: 'predictedChangePct', direction: 'desc', query: '', filter: 'all' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['proxy-high', 'stale-mid', 'ok-low', 'fail-high']);
});

test('live ranking filters by search text and success state', () => {
  const sorted = sortFundsForView([
    { code: '019633', name: '国泰半导体设备ETF联接C', status: 'error', predictedChangePct: 1 },
    { code: '016874', name: '广发远见智选混合C', status: 'ok', predictedChangePct: 2 },
  ], { sortKey: 'predictedChangePct', direction: 'desc', query: '广发', filter: 'success' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['016874']);
});

test('live ranking positive and negative filters use estimate when prediction is unavailable', () => {
  const funds = [
    { code: 'up-estimate', status: 'stale', predictedChangePct: null, estimatedChangePct: 1.2 },
    { code: 'down-estimate', status: 'stale', predictedChangePct: null, estimatedChangePct: -0.4 },
    { code: 'up-prediction', status: 'ok', predictedChangePct: 0.8, estimatedChangePct: -2 },
    { code: 'down-prediction', status: 'ok', predictedChangePct: -0.5, estimatedChangePct: 3 },
  ];

  assert.deepEqual(
    sortFundsForView(funds, { filter: 'positive' }).map((fund) => fund.code),
    ['up-prediction', 'up-estimate'],
  );
  assert.deepEqual(
    sortFundsForView(funds, { filter: 'negative' }).map((fund) => fund.code),
    ['down-prediction', 'down-estimate'],
  );
});

test('live ranking can filter out proxy estimates explicitly', () => {
  const sorted = sortFundsForView([
    { code: 'normal', status: 'ok', predictedChangePct: 1 },
    { code: 'proxy', status: 'proxy', predictedChangePct: 2 },
    { code: 'stale', status: 'stale', predictedChangePct: 3 },
    { code: 'error', status: 'error', predictedChangePct: 4 },
  ], { filter: 'nonProxy' });

  assert.deepEqual(sorted.map((fund) => fund.code), ['stale', 'normal']);
});

test('live ranking filters by fund group alongside status filters', () => {
  const sorted = sortFundsForView([
    { code: 'tech-up', group: '科技', status: 'ok', predictedChangePct: 1 },
    { code: 'tech-error', group: '科技', status: 'error', predictedChangePct: 9 },
    { code: 'medical-up', group: '医药', status: 'ok', predictedChangePct: 3 },
    { code: 'tech-down', group: '科技', status: 'ok', predictedChangePct: -1 },
  ], {
    sortKey: 'predictedChangePct',
    direction: 'desc',
    filter: 'success',
    groupFilter: '科技',
  });

  assert.deepEqual(sorted.map((fund) => fund.code), ['tech-up', 'tech-down']);
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

test('browser live prediction estimates previous trading day quotes with stale status', () => {
  const prediction = predictLiveQuote({
    code: '019348',
    navDate: '2026-05-21',
    nav: 2.8651,
    estimatedNav: 2.9452,
    estimatedChangePct: 2.79,
    quoteTime: '2026-05-22 15:00',
  }, [], '2026-05-24');

  assert.equal(prediction.status, 'stale');
  assert.equal(prediction.predictedNav, 2.9452);
  assert.equal(prediction.predictedChangePct, 2.8);
  assert.match(prediction.message, /上一交易日估算/);
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

test('browser refresh carries forward previous official NAV fields for proxy fallback', () => {
  const funds = carryForwardQuoteSnapshot([
    { code: '005125', fallbackName: '华宝标普中国A股红利机会ETF联接（LOF）C' },
  ], [
    {
      code: '005125',
      name: '华宝标普中国A股红利机会ETF联接（LOF）C',
      navDate: '2026-05-22',
      nav: 1.5,
      officialChangePct: 0.1,
      officialNavSource: 'fundf10.eastmoney.com',
    },
  ]);

  assert.equal(funds[0].navDate, '2026-05-22');
  assert.equal(funds[0].nav, 1.5);
  assert.equal(funds[0].officialNavSource, 'fundf10.eastmoney.com');
});

test('browser refresh applies fresh benchmark quotes to catalog funds', () => {
  const funds = applyBenchmarkQuotes([
    {
      code: '005125',
      benchmark: { secid: '1.501029', name: '红利基金LOF', sensitivity: 0.05, proxySensitivity: 1 },
    },
  ], new Map([[
    '1.501029',
    {
      secid: '1.501029',
      name: '红利基金LOF',
      changePct: 0.22,
      source: 'qt.gtimg.cn',
      proxySensitivity: 1,
    },
  ]]));

  assert.equal(funds[0].benchmark.changePct, 0.22);
  assert.equal(funds[0].benchmark.proxySensitivity, 1);
});
