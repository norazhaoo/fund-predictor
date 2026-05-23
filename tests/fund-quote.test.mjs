import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFundJsonp, normalizeQuote, fetchFundQuote } from '../scripts/fund-quote.mjs';

const jsonp = 'jsonpgz({"fundcode":"019633","name":"国泰半导体设备ETF联接C","jzrq":"2026-05-22","dwjz":"2.5314","gsz":"2.5534","gszzl":"0.87","gztime":"2026-05-23 14:30"});';

test('parseFundJsonp parses Eastmoney-style JSONP payload', () => {
  assert.deepEqual(parseFundJsonp(jsonp), {
    fundcode: '019633',
    name: '国泰半导体设备ETF联接C',
    jzrq: '2026-05-22',
    dwjz: '2.5314',
    gsz: '2.5534',
    gszzl: '0.87',
    gztime: '2026-05-23 14:30',
  });
});

test('parseFundJsonp trims harmless leading and trailing whitespace', () => {
  assert.equal(parseFundJsonp(`\n ${jsonp}\n`).fundcode, '019633');
});

test('normalizeQuote converts numeric strings and keeps source fields', () => {
  assert.deepEqual(normalizeQuote(parseFundJsonp(jsonp), 'fallback'), {
    code: '019633',
    name: '国泰半导体设备ETF联接C',
    navDate: '2026-05-22',
    nav: 2.5314,
    estimatedNav: 2.5534,
    estimatedChangePct: 0.87,
    quoteTime: '2026-05-23 14:30',
    source: 'fundgz.1234567.com.cn',
  });
});

test('normalizeQuote falls back to configured name when payload name is missing', () => {
  const quote = normalizeQuote({ fundcode: '015903', dwjz: '1.4808' }, '博时优质精选混合C');
  assert.equal(quote.name, '博时优质精选混合C');
  assert.equal(quote.estimatedNav, null);
});

test('parseFundJsonp rejects malformed payloads', () => {
  assert.throws(() => parseFundJsonp('not-jsonp'), /Unable to parse fund JSONP/);
  assert.throws(() => parseFundJsonp('jsonpgz({bad});'), /Unable to parse fund JSONP/);
});

test('fetchFundQuote returns a normalized quote for a matching fund payload', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => jsonp,
    };
  };

  const quote = await fetchFundQuote({ code: '019633', fallbackName: 'fallback' }, fetchImpl);

  assert.equal(quote.code, '019633');
  assert.equal(quote.name, '国泰半导体设备ETF联接C');
  assert.equal(quote.estimatedNav, 2.5534);
  assert.match(calls[0].url, /^https:\/\/fundgz\.1234567\.com\.cn\/js\/019633\.js\?rt=\d+$/);
  assert.equal(calls[0].options.headers.accept, '*/*');
});

test('fetchFundQuote rejects payloads that do not match the requested fund code', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => 'jsonpgz({});',
  });

  await assert.rejects(
    fetchFundQuote({ code: '019633', fallbackName: 'fallback' }, fetchImpl),
    /Quote identity mismatch for 019633/,
  );
});
