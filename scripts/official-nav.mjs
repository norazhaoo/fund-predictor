const SOURCE_HOST = 'fundf10.eastmoney.com';

function htmlDecode(value) {
  return String(value ?? '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(String(value).replace('%', '').trim());
  return Number.isFinite(number) ? number : null;
}

function round4(value) {
  return Number(value.toFixed(4));
}

function rebaseEstimateFields(quote, officialNav) {
  const rebasedEstimatedNav = Number.isFinite(quote.estimatedChangePct)
    ? round4(officialNav.nav * (1 + quote.estimatedChangePct / 100))
    : null;
  return {
    ...(Number.isFinite(quote.estimatedNav) ? { rawEstimatedNav: quote.estimatedNav } : {}),
    estimatedNav: rebasedEstimatedNav,
    ...(Number.isFinite(quote.estimatedNav) || Number.isFinite(rebasedEstimatedNav)
      ? { estimateRebased: true }
      : {}),
  };
}

function parseApidataContent(text) {
  const match = text.match(/content\s*:\s*"([\s\S]*?)"\s*,\s*records/);
  if (!match) {
    throw new Error('Unable to parse official NAV payload');
  }
  return htmlDecode(match[1].replace(/\\"/g, '"'));
}

function firstRowCells(html) {
  const row = html.match(/<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/i)?.[1];
  if (!row) {
    throw new Error('Official NAV table has no rows');
  }
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
}

export function parseOfficialNavPayload(text, code) {
  const cells = firstRowCells(parseApidataContent(text));
  if (cells.length < 4) {
    throw new Error('Official NAV table has too few cells');
  }
  const nav = toNumber(cells[1]);
  if (!cells[0] || !Number.isFinite(nav)) {
    throw new Error('Official NAV row is incomplete');
  }
  return {
    code: String(code).padStart(6, '0'),
    navDate: cells[0],
    nav,
    dailyChangePct: toNumber(cells[3]),
    source: SOURCE_HOST,
  };
}

export async function fetchOfficialNav(fund, fetchImpl = fetch) {
  const code = String(fund.code).padStart(6, '0');
  const url = `https://${SOURCE_HOST}/F10DataApi.aspx?type=lsjz&code=${code}&page=1&per=1&rt=${Date.now()}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: '*/*',
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
    ...rebaseEstimateFields(quote, officialNav),
    officialChangePct: officialNav.dailyChangePct,
    officialNavSource: officialNav.source,
  };
}
