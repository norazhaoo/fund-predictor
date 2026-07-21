const SOURCE_HOST = 'fundmobapi.eastmoney.com';

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(String(value).replace('%', '').trim());
  return Number.isFinite(number) ? number : null;
}

export function parseOfficialNavPayload(text, code) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Unable to parse official NAV payload');
  }

  const expectedCode = String(code).padStart(6, '0');
  const row = Array.isArray(payload?.Datas)
    ? payload.Datas.find((item) => String(item?.FCODE ?? '').padStart(6, '0') === expectedCode)
    : null;
  const nav = toNumber(row?.NAV);
  if (!row?.PDATE || !Number.isFinite(nav)) {
    throw new Error(`Official NAV data unavailable for ${expectedCode}`);
  }

  return {
    code: expectedCode,
    navDate: row.PDATE,
    nav,
    dailyChangePct: toNumber(row.NAVCHGRT),
    source: SOURCE_HOST,
  };
}

export async function fetchOfficialNav(fund, fetchImpl = fetch) {
  const code = String(fund.code).padStart(6, '0');
  const url = new URL(`https://${SOURCE_HOST}/FundMNewApi/FundMNFInfo`);
  url.search = new URLSearchParams({
    pageIndex: '1',
    pageSize: '1',
    plat: 'Android',
    appType: 'ttjj',
    product: 'EFund',
    Version: '6.2.8',
    deviceid: 'fund-predictor',
    Fcodes: code,
  }).toString();
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'fund-predictor/0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`Official NAV request failed for ${code}: HTTP ${response.status}`);
  }
  return parseOfficialNavPayload(await response.text(), code);
}

export function mergeOfficialNav(quote, officialNav) {
  if (!officialNav?.navDate || !Number.isFinite(officialNav.nav)) {
    return quote;
  }
  if (quote.navDate && quote.navDate >= officialNav.navDate) {
    return {
      ...quote,
      officialNavSource: quote.officialNavSource ?? quote.source,
    };
  }
  return {
    ...quote,
    navDate: officialNav.navDate,
    nav: officialNav.nav,
    officialChangePct: officialNav.dailyChangePct,
    officialNavSource: officialNav.source,
  };
}
