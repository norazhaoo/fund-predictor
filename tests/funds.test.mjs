import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FUNDS, TIME_ZONE } from '../scripts/funds.mjs';

const SCREENSHOT_WATCHLIST_CODES = [
  '016665', '015465', '019449', '026211', '018933', '007776', '014767',
  '000390', '001438', '290008', '020671', '008984', '022404', '004320',
  '017654', '018036', '027063', '017470', '024239', '006503', '019455',
  '021842', '007509', '014542', '017175', '021876', '013180', '014937',
  '010052', '013470', '026245', '001618', '025209', '024070', '014847',
  '018737', '012887', '020434', '014320', '270023', '018230', '024170',
  '021523', '017103', '206015', '007969', '004103', '002277', '003204',
  '019032', '013507', '021533', '020436', '025881', '015060', '025547',
  '017076', '025660', '023408', '012700', '004497', '023639', '024620',
  '025500', '019830', '017612', '008989', '016579', '011120', '010416',
  '011370', '020357', '004450', '011241', '002163', '018816', '016531',
  '015915', '015916', '018125', '001717', '009225', '019005',
];

test('watched funds contain the imported screenshot watchlist', () => {
  assert.equal(FUNDS.length, 235);
  assert.equal(new Set(FUNDS.map((fund) => fund.code)).size, FUNDS.length);

  const catalogCodes = new Set(FUNDS.map((fund) => fund.code));
  assert.deepEqual(
    SCREENSHOT_WATCHLIST_CODES.filter((code) => !catalogCodes.has(code)),
    [],
  );
});

test('fund metadata uses Beijing timezone for scheduling and display', () => {
  assert.equal(TIME_ZONE, 'Asia/Shanghai');
  assert.ok(FUNDS.every((fund) => /^\d{6}$/.test(fund.code)));
  assert.ok(FUNDS.every((fund, index) => fund.order === index + 1));
});

test('fund catalog is stored as shared browser-readable JSON', async () => {
  const catalog = JSON.parse(await readFile('data/funds.json', 'utf8'));
  assert.equal(catalog.funds.length, 235);
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
