import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FUNDS, TIME_ZONE } from '../scripts/funds.mjs';

test('watched funds contain the four selected fund codes', () => {
  assert.deepEqual(
    FUNDS.map((fund) => fund.code),
    ['019633', '016874', '020744', '015903'],
  );
});

test('fund metadata uses Beijing timezone for scheduling and display', () => {
  assert.equal(TIME_ZONE, 'Asia/Shanghai');
  assert.ok(FUNDS.every((fund) => /^\d{6}$/.test(fund.code)));
});

test('fund catalog is stored as shared browser-readable JSON', async () => {
  const catalog = JSON.parse(await readFile('data/funds.json', 'utf8'));
  assert.deepEqual(
    catalog.funds.map((fund) => fund.code),
    ['019633', '016874', '020744', '015903'],
  );
  assert.deepEqual(
    FUNDS.map((fund) => fund.code),
    catalog.funds.map((fund) => fund.code),
  );
});
