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
  await writeJsonFile(latestPath, initialLatest);
  await writeJsonFile(historyPath, initialHistory);
  return {
    latestPath,
    historyPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test('same-day retry with failed quote does not replace existing good history record', async () => {
  const goodRecord = buildHistoryRecord('2026-05-25', 'old-run', predictionFor(fundA));
  const files = await withDataFiles({ version: 1, records: [goodRecord] });
  try {
    await runUpdate({
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

test('weekday stale quote whose quoteTime date differs from tradingDate is shown stale and not written to history', async () => {
  const files = await withDataFiles();
  try {
    await runUpdate({
      now: monday,
      funds: [fundA],
      latestPath: files.latestPath,
      historyPath: files.historyPath,
      fetchQuote: async () => quote(fundA, { quoteTime: '2026-05-22 15:00' }),
    });

    const latest = await readJsonFile(files.latestPath, null);
    const history = await readJsonFile(files.historyPath, null);
    assert.equal(latest.funds[0].status, 'stale');
    assert.equal(latest.funds[0].predictedNav, null);
    assert.equal(latest.funds[0].predictedChangePct, null);
    assert.match(latest.funds[0].message, /不是 2026-05-25/);
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
    await runUpdate({
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
    await runUpdate({
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
