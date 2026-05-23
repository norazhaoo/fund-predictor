import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildHistoryRecord,
  readJsonFile,
  upsertHistoryRecords,
  backfillActualNavs,
  writeJsonFile,
} from '../scripts/history-store.mjs';

const prediction = {
  code: '019633',
  name: '国泰半导体设备ETF联接C',
  navDate: '2026-05-22',
  nav: 2.5314,
  estimatedNav: 2.5534,
  estimatedChangePct: 0.87,
  quoteTime: '2026-05-23 14:30',
  predictedNav: 2.5534,
  predictedChangePct: 0.87,
  calibration: 0,
  samplesUsed: 0,
  status: 'ok',
  message: '历史样本不足，暂以盘中估值作为预测。',
  source: 'fundgz.1234567.com.cn',
};

test('buildHistoryRecord stores compact daily prediction fields', () => {
  assert.deepEqual(buildHistoryRecord('2026-05-23', '2026-05-23T06:30:00.000Z', prediction), {
    date: '2026-05-23',
    code: '019633',
    name: '国泰半导体设备ETF联接C',
    generatedAt: '2026-05-23T06:30:00.000Z',
    quoteTime: '2026-05-23 14:30',
    navDateAtPrediction: '2026-05-22',
    navAtPrediction: 2.5314,
    estimateNav: 2.5534,
    estimateChangePct: 0.87,
    predictedNav: 2.5534,
    predictedChangePct: 0.87,
    calibration: 0,
    samplesUsed: 0,
    status: 'ok',
    actualNav: null,
    actualNavDate: null,
    error: null,
  });
});

test('upsertHistoryRecords replaces same date and code instead of duplicating', () => {
  const original = buildHistoryRecord('2026-05-23', 'old', prediction);
  const replacement = buildHistoryRecord('2026-05-23', 'new', { ...prediction, predictedNav: 2.56 });
  const history = upsertHistoryRecords({ version: 1, records: [original] }, [replacement]);
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].generatedAt, 'new');
  assert.equal(history.records[0].predictedNav, 2.56);
});

test('backfillActualNavs fills official NAV and prediction error when quote nav date matches', () => {
  const record = buildHistoryRecord('2026-05-23', 'run', prediction);
  const history = { version: 1, records: [record] };
  const quotes = [{ code: '019633', navDate: '2026-05-23', nav: 2.561 }];
  const updated = backfillActualNavs(history, quotes);
  assert.equal(updated.records[0].actualNav, 2.561);
  assert.equal(updated.records[0].actualNavDate, '2026-05-23');
  assert.equal(updated.records[0].error, 0.0076);
});

test('writeJsonFile creates parent directories for file URL paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fund-history-'));
  const path = new URL('nested/history.json', pathToFileURL(`${dir}/`));
  try {
    await writeJsonFile(path, { version: 1, records: [] });
    assert.deepEqual(await readJsonFile(path, null), { version: 1, records: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
