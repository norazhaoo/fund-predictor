import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachBenchmarkQuote,
  fetchBenchmarkQuotes,
  parseBenchmarkPayload,
} from '../scripts/benchmark-quote.mjs';

function tencentLine(symbol, code, price, quoteTime, change, changePct) {
  const fields = Array(33).fill('');
  fields[2] = code;
  fields[3] = String(price);
  fields[30] = quoteTime;
  fields[31] = String(change);
  fields[32] = String(changePct);
  return `v_${symbol}="${fields.join('~')}";`;
}

const payload = [
  tencentLine('sh000300', '000300', 4845.1, '20260522161403', 62.0, 1.3),
  tencentLine('sh000688', '000688', 1790.77, '20260522161409', 26.6, 1.51),
  tencentLine('hkHSI', 'HSI', 25606.03, '2026/05/22 18:31:21', 219.51, 0.86),
].join('\n');

test('parseBenchmarkPayload extracts benchmark quotes by configured secid', () => {
  const quotes = parseBenchmarkPayload(payload, [
    { secid: '1.000300', name: '沪深300', sensitivity: 0.03 },
    { secid: '1.000688', name: '科创50', sensitivity: 0.05 },
  ]);

  assert.deepEqual(quotes.get('1.000688'), {
    secid: '1.000688',
    code: '000688',
    name: '科创50',
    price: 1790.77,
    changePct: 1.51,
    change: 26.6,
    sensitivity: 0.05,
    source: 'qt.gtimg.cn',
    quoteTime: '20260522161409',
  });
});

test('parseBenchmarkPayload supports Hong Kong index symbols', () => {
  const quotes = parseBenchmarkPayload(payload, [
    { secid: '100.HSI', name: '恒生指数', sensitivity: 0.05 },
  ]);

  assert.deepEqual(quotes.get('100.HSI'), {
    secid: '100.HSI',
    code: 'HSI',
    name: '恒生指数',
    price: 25606.03,
    changePct: 0.86,
    change: 219.51,
    sensitivity: 0.05,
    source: 'qt.gtimg.cn',
    quoteTime: '2026/05/22 18:31:21',
  });
});

test('fetchBenchmarkQuotes requests unique benchmark secids', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => payload,
    };
  };

  const quotes = await fetchBenchmarkQuotes([
    { secid: '1.000300', name: '沪深300', sensitivity: 0.03 },
    { secid: '1.000300', name: '沪深300', sensitivity: 0.03 },
  ], fetchImpl);

  assert.equal(quotes.get('1.000300').changePct, 1.3);
  assert.match(calls[0].url, /q=sh000300$/);
  assert.equal(calls[0].options.headers.accept, '*/*');
});

test('attachBenchmarkQuote copies benchmark quote and sensitivity to a fund quote', () => {
  const benchmarkQuotes = parseBenchmarkPayload(payload, [
    { secid: '1.000688', name: '科创50', sensitivity: 0.05 },
  ]);
  const quote = attachBenchmarkQuote(
    { code: '019633', estimatedChangePct: 1.01 },
    { benchmark: { secid: '1.000688', name: '科创50', sensitivity: 0.05 } },
    benchmarkQuotes,
  );

  assert.equal(quote.benchmark.name, '科创50');
  assert.equal(quote.benchmark.changePct, 1.51);
  assert.equal(quote.benchmarkSensitivity, 0.05);
});
