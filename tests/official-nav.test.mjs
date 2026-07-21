import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOfficialNav,
  mergeOfficialNav,
  parseOfficialNavPayload,
} from '../scripts/official-nav.mjs';

const mobilePayload = JSON.stringify({
  ErrCode: 0,
  Success: true,
  Datas: [{
    FCODE: '019633',
    SHORTNAME: '国泰半导体设备ETF联接C',
    PDATE: '2026-05-22',
    NAV: '2.5314',
    NAVCHGRT: '0.87',
  }],
});

test('parseOfficialNavPayload extracts latest official NAV from mobile API payload', () => {
  assert.deepEqual(parseOfficialNavPayload(mobilePayload, '019633'), {
    code: '019633',
    navDate: '2026-05-22',
    nav: 2.5314,
    dailyChangePct: 0.87,
    source: 'fundmobapi.eastmoney.com',
  });
});

test('parseOfficialNavPayload rejects invalid or missing fund data', () => {
  assert.throws(() => parseOfficialNavPayload('<html>not json</html>', '019633'), /Unable to parse/);
  assert.throws(
    () => parseOfficialNavPayload(JSON.stringify({ Datas: [] }), '019633'),
    /unavailable for 019633/,
  );
});

test('fetchOfficialNav requests the mobile latest NAV endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => mobilePayload,
    };
  };

  const nav = await fetchOfficialNav({ code: '019633' }, fetchImpl);

  assert.equal(nav.navDate, '2026-05-22');
  assert.equal(calls[0].url.hostname, 'fundmobapi.eastmoney.com');
  assert.equal(calls[0].url.pathname, '/FundMNewApi/FundMNFInfo');
  assert.equal(calls[0].url.searchParams.get('Fcodes'), '019633');
  assert.equal(calls[0].options.headers.accept, 'application/json');
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
  const officialNav = parseOfficialNavPayload(mobilePayload, '019633');

  assert.deepEqual(mergeOfficialNav(quote, officialNav), {
    ...quote,
    navDate: '2026-05-22',
    nav: 2.5314,
    officialChangePct: 0.87,
    officialNavSource: 'fundmobapi.eastmoney.com',
  });
});
