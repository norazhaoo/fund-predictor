import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOfficialNav,
  mergeOfficialNav,
  parseOfficialNavPayload,
} from '../scripts/official-nav.mjs';

const f10Payload = `var apidata={ content:"<table class='w782 comm lsjz'><thead><tr><th class='first'>净值日期</th><th>单位净值</th><th>累计净值</th><th>日增长率</th></tr></thead><tbody><tr><td>2026-05-22</td><td class='tor bold'>2.5314</td><td class='tor bold'>2.5314</td><td class='tor bold red'>0.87%</td></tr></tbody></table>",records:636,pages:636,curpage:1};`;

test('parseOfficialNavPayload extracts latest official NAV from F10 table payload', () => {
  assert.deepEqual(parseOfficialNavPayload(f10Payload, '019633'), {
    code: '019633',
    navDate: '2026-05-22',
    nav: 2.5314,
    dailyChangePct: 0.87,
    source: 'fundf10.eastmoney.com',
  });
});

test('fetchOfficialNav requests the one-row F10 latest NAV endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => f10Payload,
    };
  };

  const nav = await fetchOfficialNav({ code: '019633' }, fetchImpl);

  assert.equal(nav.navDate, '2026-05-22');
  assert.match(calls[0].url, /^https:\/\/fundf10\.eastmoney\.com\/F10DataApi\.aspx\?type=lsjz&code=019633&page=1&per=1/);
  assert.equal(calls[0].options.headers.accept, '*/*');
});

test('mergeOfficialNav keeps newer official NAV without changing intraday estimate fields', () => {
  const quote = {
    code: '019633',
    navDate: '2026-05-21',
    nav: 2.5095,
    estimatedNav: 2.5348,
    estimatedChangePct: 1.01,
    quoteTime: '2026-05-22 15:00',
  };
  const officialNav = parseOfficialNavPayload(f10Payload, '019633');

  assert.deepEqual(mergeOfficialNav(quote, officialNav), {
    ...quote,
    navDate: '2026-05-22',
    nav: 2.5314,
    officialChangePct: 0.87,
    officialNavSource: 'fundf10.eastmoney.com',
  });
});
