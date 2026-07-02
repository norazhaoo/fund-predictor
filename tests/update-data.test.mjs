import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpdate } from '../scripts/update-data.mjs';
import {
  buildHistoryRecord,
  readJsonFile,
  writeJsonFile,
} from '../scripts/history-store.mjs';

const monday = new Date('2026-05-25T06:30:00.000Z');
const fundA = { code: '019633', fallbackName: '国泰半导体设备ETF联接C' };
const fundB = { code: '016874', fallbackName: '广发远见智选混合C' };
const fundC = { code: '020744', fallbackName: '广发恒生消费ETF联接(QDII)C' };

function quote(fund, overrides = {}) {
  return {
    code: fund.code,
    name: fund.fallbackName,
    navDate: '2026-05-22',
    nav: 2.5,
    estimatedNav: 2.55,
    estimatedChangePct: 2,
    quoteTime: '2026-05-25 14:30',
    source: 'fundgz.1234567.com.cn',
    ...overrides,
  };
}

function predictionFor(fund, overrides = {}) {
  return {
    ...quote(fund),
    predictedNav: 2.55,
    predictedChangePct: 2,
    calibration: 0,
    samplesUsed: 0,
    status: 'ok',
    ...overrides,
  };
}

async function withDataFiles(initialHistory = { version: 1, records: [] }, initialLatest = { version: 1, funds: [] }) {
  const dir = await mkdtemp(join(tmpdir(), 'fund-update-'));
  const latestPath = join(dir, 'data/latest.json');
  const historyPath = join(dir, 'data/history.json');
  const snapshotsPath = join(dir, 'data/refresh-snapshots.json');
  await writeJsonFile(latestPath, initialLatest);
  await writeJsonFile(historyPath, initialHistory);
  return {
    latestPath,
    historyPath,
    snapshotsPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function runUpdateForTest(options) {
  return runUpdate({
    fetchOfficial: async () => null,
    fetchBenchmark: async () => new Map(),
    ...options,
  });
}

test('same-day retry with failed quote does not replace existing good history record', async () => {
  const goodRecord = buildHistoryRecord('2026-05-25', 'old-run', predictionFor(fundA));
  const files = await withDataFiles({ version: 1, records: [goodRecord] });
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA, fundB],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async (fund) => {
        if (fund.code === fundA.code) {
          throw new Error('network down');
        }
        return quote(fundB);
      },
    });

    const history = await readJsonFile(files.historyPath, null);
    const recordA = history.records.find((record) => record.code === fundA.code);
    assert.equal(recordA.generatedAt, 'old-run');
    assert.equal(recordA.status, 'ok');
    assert.equal(recordA.predictedNav, 2.55);
  } finally {
    await files.cleanup();
  }
});

test('weekday previous trading day quote is estimated but not written to history', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => quote(fundA, { quoteTime: '2026-05-22 15:00' }),
    });

    const latest = await readJsonFile(files.latestPath, null);
    const history = await readJsonFile(files.historyPath, null);
    assert.equal(latest.funds[0].status, 'stale');
    assert.equal(latest.funds[0].predictedNav, 2.55);
    assert.equal(latest.funds[0].predictedChangePct, 2);
    assert.match(latest.funds[0].message, /上一交易日估算/);
    assert.equal(history.records.length, 0);
  } finally {
    await files.cleanup();
  }
});

test('all-fetch failure writes error latest without replacing history', async () => {
  const initialLatest = { version: 1, generatedAt: 'old', funds: [{ code: 'kept' }] };
  const initialHistory = {
    version: 1,
    records: [buildHistoryRecord('2026-05-25', 'old-run', predictionFor(fundA))],
  };
  const files = await withDataFiles(initialHistory, initialLatest);
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA, fundB],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => {
        throw new Error('endpoint unavailable');
      },
    });

    const latest = await readJsonFile(files.latestPath, null);
    assert.equal(latest.summary, '全部基金数据更新失败，已保留历史记录。');
    assert.deepEqual(latest.funds.map((fund) => fund.status), ['error', 'error']);
    assert.deepEqual(latest.funds.map((fund) => fund.predictedNav), [null, null]);
    assert.deepEqual(await readJsonFile(files.historyPath, null), initialHistory);
  } finally {
    await files.cleanup();
  }
});

test('partial failure writes latest but history only includes valid fresh ok predictions', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA, fundB, fundC],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async (fund) => {
        if (fund.code === fundA.code) {
          throw new Error('temporary outage');
        }
        if (fund.code === fundC.code) {
          return quote(fundC, { quoteTime: '2026-05-22 15:00' });
        }
        return quote(fundB);
      },
    });

    const latest = await readJsonFile(files.latestPath, null);
    const history = await readJsonFile(files.historyPath, null);
    assert.deepEqual(latest.funds.map((fund) => fund.status), ['error', 'ok', 'stale']);
    assert.deepEqual(history.records.map((record) => record.code), [fundB.code]);
  } finally {
    await files.cleanup();
  }
});

test('every update run appends a refresh snapshot even on the same trading day', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      snapshotsPath: files.snapshotsPath,
      fetchQuote: async () => quote(fundA, { quoteTime: '2026-05-25 14:30' }),
    });
    await runUpdateForTest({
      now: new Date('2026-05-25T06:45:00.000Z'),
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      snapshotsPath: files.snapshotsPath,
      fetchQuote: async () => quote(fundA, { quoteTime: '2026-05-25 14:45' }),
    });

    const snapshots = await readJsonFile(files.snapshotsPath, null);
    assert.equal(snapshots.version, 1);
    assert.equal(snapshots.snapshots.length, 2);
    assert.deepEqual(
      snapshots.snapshots.map((snapshot) => snapshot.generatedAt),
      ['2026-05-25T06:30:00.000Z', '2026-05-25T06:45:00.000Z'],
    );
    assert.deepEqual(
      snapshots.snapshots.map((snapshot) => snapshot.counts),
      [
        { total: 1, ok: 1, confirmed: 0, proxy: 0, stale: 0, error: 0 },
        { total: 1, ok: 1, confirmed: 0, proxy: 0, stale: 0, error: 0 },
      ],
    );
    assert.equal(snapshots.snapshots[0].funds[0].code, fundA.code);
    assert.equal(snapshots.snapshots[0].funds[0].predictedNav, 2.55);
    assert.equal(snapshots.snapshots[1].funds[0].quoteTime, '2026-05-25 14:45');
  } finally {
    await files.cleanup();
  }
});

test('quote fetching is concurrency limited for large watchlists', async () => {
  const files = await withDataFiles();
  const funds = Array.from({ length: 5 }, (_, index) => ({
    code: String(index + 1).padStart(6, '0'),
    fallbackName: `基金${index + 1}`,
  }));
  let inFlight = 0;
  let maxInFlight = 0;

  try {
    await runUpdateForTest({
      now: monday,
      funds,
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      quoteConcurrency: 2,
      fetchOfficial: async () => null,
      fetchBenchmark: async () => new Map(),
      fetchQuote: async (fund) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return quote(fund);
      },
    });

    assert.equal(maxInFlight, 2);
  } finally {
    await files.cleanup();
  }
});

test('quote fetching retries rate-capped failures before writing latest', async () => {
  const files = await withDataFiles();
  let attempts = 0;
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      quoteRetryBackoffMs: 0,
      fetchOfficial: async () => null,
      fetchBenchmark: async () => new Map(),
      fetchQuote: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Quote request failed for 019633: HTTP 514 Frequency Capped');
        }
        return quote(fundA);
      },
    });

    const latest = await readJsonFile(files.latestPath, null);
    assert.equal(attempts, 2);
    assert.equal(latest.funds[0].status, 'ok');
    assert.equal(latest.summary, '已生成 1/1 只基金预测。');
  } finally {
    await files.cleanup();
  }
});

test('quote fetching pauses the shared request queue after a rate cap', async () => {
  const files = await withDataFiles();
  const calls = [];
  const sleeps = [];
  const funds = [
    { code: '000001', fallbackName: '基金1' },
    { code: '000002', fallbackName: '基金2' },
    { code: '000003', fallbackName: '基金3' },
  ];

  try {
    const update = runUpdateForTest({
      now: monday,
      funds,
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      quoteConcurrency: 2,
      quoteRequestSpacingMs: 0,
      quoteRetryBackoffMs: 3000,
      fetchOfficial: async () => null,
      fetchBenchmark: async () => new Map(),
      sleepFn: (ms) => new Promise((resolve) => sleeps.push({ ms, resolve })),
      fetchQuote: async (fund) => {
        calls.push(fund.code);
        if (fund.code === '000001' && calls.filter((code) => code === fund.code).length === 1) {
          throw new Error('Quote request failed for 000001: HTTP 514 Frequency Capped');
        }
        return quote(fund);
      },
    });

    for (let index = 0; index < 20 && (sleeps.length === 0 || calls.length < 2); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual([...calls], ['000001', '000002']);
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0].ms, 3000);
    sleeps.shift().resolve();

    const { latest } = await update;
    assert.equal(latest.funds.filter((fund) => fund.status === 'ok').length, 3);
    assert.deepEqual(calls.toSorted(), ['000001', '000001', '000002', '000003']);
  } finally {
    await files.cleanup();
  }
});

test('newer official NAV source updates stale quote NAV fields before writing latest', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => quote(fundA, {
        navDate: '2026-05-21',
        nav: 2.5095,
        estimatedNav: 2.5348,
        estimatedChangePct: 1.01,
        quoteTime: '2026-05-22 15:00',
      }),
      fetchOfficial: async () => ({
        code: fundA.code,
        navDate: '2026-05-22',
        nav: 2.5314,
        dailyChangePct: 0.87,
        source: 'fundf10.eastmoney.com',
      }),
    });

    const latest = await readJsonFile(files.latestPath, null);
    assert.equal(latest.funds[0].navDate, '2026-05-22');
    assert.equal(latest.funds[0].nav, 2.5314);
    assert.equal(latest.funds[0].officialChangePct, 0.87);
    assert.equal(latest.funds[0].officialNavSource, 'fundf10.eastmoney.com');
  } finally {
    await files.cleanup();
  }
});

test('confirmed official NAV uses official daily change instead of stale estimate drift', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: new Date('2026-07-02T11:57:03.824Z'),
      funds: [{
        code: '006503',
        fallbackName: '财通集成电路产业股票C',
        benchmark: { secid: '0.159995', name: '芯片ETF', sensitivity: 0.9, proxySensitivity: 0.9 },
      }],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async (fund) => quote(fund, {
        navDate: '2026-07-01',
        nav: 9.2732,
        estimatedNav: 8.7533,
        estimatedChangePct: -5.61,
        quoteTime: '2026-07-02 15:00',
      }),
      fetchOfficial: async () => ({
        code: '006503',
        navDate: '2026-07-02',
        nav: 8.5723,
        dailyChangePct: -7.56,
        source: 'fundf10.eastmoney.com',
      }),
      fetchBenchmark: async () => new Map([[
        '0.159995',
        {
          secid: '0.159995',
          code: '159995',
          name: '芯片ETF',
          changePct: -9.09,
          source: 'qt.gtimg.cn',
          sensitivity: 0.9,
          proxySensitivity: 0.9,
        },
      ]]),
    });

    const latest = await readJsonFile(files.latestPath, null);
    assert.equal(latest.funds[0].status, 'confirmed');
    assert.equal(latest.funds[0].nav, 8.5723);
    assert.equal(latest.funds[0].predictedNav, 8.5723);
    assert.equal(latest.funds[0].officialChangePct, -7.56);
    assert.equal(latest.funds[0].predictedChangePct, -7.56);
    assert.match(latest.funds[0].message, /官方净值/);
  } finally {
    await files.cleanup();
  }
});

test('early morning refresh confirms the previous trading day official NAV', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: new Date('2026-07-02T16:10:00.000Z'),
      funds: [fundB],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => quote(fundB, {
        navDate: '2026-07-01',
        nav: 2.3918,
        estimatedNav: 2.2497,
        estimatedChangePct: -5.94,
        quoteTime: '2026-07-02 15:00',
      }),
      fetchOfficial: async () => ({
        code: fundB.code,
        navDate: '2026-07-02',
        nav: 2.4009,
        dailyChangePct: 0.38,
        source: 'fundf10.eastmoney.com',
      }),
    });

    const latest = await readJsonFile(files.latestPath, null);
    const history = await readJsonFile(files.historyPath, null);
    assert.equal(latest.tradingDate, '2026-07-02');
    assert.equal(latest.funds[0].status, 'confirmed');
    assert.equal(latest.funds[0].predictedChangePct, 0.38);
    assert.equal(history.records[0].date, '2026-07-02');
    assert.equal(history.records[0].status, 'confirmed');
  } finally {
    await files.cleanup();
  }
});

test('benchmark source adds a small benchmark adjustment to fresh predictions', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [{
        ...fundA,
        benchmark: { secid: '1.000688', name: '科创50', sensitivity: 0.05 },
      }],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => quote(fundA, {
        nav: 2,
        estimatedNav: 2.1,
        estimatedChangePct: 2,
        quoteTime: '2026-05-25 14:30',
      }),
      fetchOfficial: async () => null,
      fetchBenchmark: async () => new Map([[
        '1.000688',
        {
          secid: '1.000688',
          code: '000688',
          name: '科创50',
          price: 1790.77,
          changePct: 4,
          source: 'push2.eastmoney.com',
          sensitivity: 0.05,
        },
      ]]),
    });

    const latest = await readJsonFile(files.latestPath, null);
    assert.equal(latest.funds[0].benchmark.name, '科创50');
    assert.equal(latest.funds[0].benchmarkAdjustment, 0.002);
    assert.equal(latest.funds[0].predictedNav, 2.102);
  } finally {
    await files.cleanup();
  }
});

test('unavailable quote uses official NAV and benchmark as a low-confidence proxy', async () => {
  const files = await withDataFiles();
  try {
    await runUpdateForTest({
      now: monday,
      funds: [{
        code: '005125',
        fallbackName: '华宝标普中国A股红利机会ETF联接（LOF）C',
        benchmark: { secid: '1.501029', name: '红利基金LOF', sensitivity: 0.05, proxySensitivity: 1 },
      }],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => {
        throw new Error('Unable to parse fund JSONP payload');
      },
      fetchOfficial: async () => ({
        code: '005125',
        navDate: '2026-05-22',
        nav: 1.5,
        dailyChangePct: 0.1,
        source: 'fundf10.eastmoney.com',
      }),
      fetchBenchmark: async () => new Map([[
        '1.501029',
        {
          secid: '1.501029',
          code: '501029',
          name: '红利基金LOF',
          price: 1.827,
          changePct: 0.22,
          source: 'qt.gtimg.cn',
          quoteTime: '20260522161425',
          sensitivity: 0.05,
          proxySensitivity: 1,
        },
      ]]),
    });

    const latest = await readJsonFile(files.latestPath, null);
    const history = await readJsonFile(files.historyPath, null);
    assert.equal(latest.funds[0].status, 'proxy');
    assert.equal(latest.funds[0].predictedNav, 1.5033);
    assert.equal(latest.funds[0].predictedChangePct, 0.22);
    assert.equal(latest.funds[0].estimatedNav, null);
    assert.match(latest.funds[0].message, /替代估算/);
    assert.match(latest.summary, /替代估算 1 只/);
    assert.deepEqual(history.records, []);
  } finally {
    await files.cleanup();
  }
});
