import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FUNDS, TIME_ZONE } from '../scripts/funds.mjs';

test('watched funds contain the imported OCR watchlist', () => {
  assert.equal(FUNDS.length, 200);
  assert.deepEqual(
    FUNDS.slice(0, 3).map((fund) => fund.code),
    ['005538', '021842', '007509'],
  );
  assert.deepEqual(
    FUNDS.slice(-3).map((fund) => fund.code),
    ['010052', '013470', '026245'],
  );
  assert.equal(new Set(FUNDS.map((fund) => fund.code)).size, FUNDS.length);
});

test('fund metadata uses Beijing timezone for scheduling and display', () => {
  assert.equal(TIME_ZONE, 'Asia/Shanghai');
  assert.ok(FUNDS.every((fund) => /^\d{6}$/.test(fund.code)));
  assert.ok(FUNDS.every((fund, index) => fund.order === index + 1));
});

test('fund catalog is stored as shared browser-readable JSON', async () => {
  const catalog = JSON.parse(await readFile('data/funds.json', 'utf8'));
  assert.equal(catalog.funds.length, 200);
  assert.deepEqual(
    FUNDS.map((fund) => fund.code),
    catalog.funds.map((fund) => fund.code),
  );
  assert.ok(catalog.funds.every((fund) => fund.fallbackName));
  assert.ok(catalog.funds.every((fund) => typeof fund.holding === 'boolean'));
  assert.ok(catalog.funds.every((fund) => typeof fund.group === 'string'));
  assert.ok(catalog.funds.every((fund) => !fund.benchmark || fund.benchmark.secid));
  assert.ok(FUNDS.every((fund) => !fund.benchmark || fund.benchmark.secid));
});
