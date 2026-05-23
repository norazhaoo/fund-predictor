const SOURCE_HOST = 'fundgz.1234567.com.cn';

export function parseFundJsonp(text) {
  const match = text.trim().match(/^[\w$]+\((.*)\);?$/s);
  if (!match) {
    throw new Error('Unable to parse fund JSONP payload');
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error('Unable to parse fund JSONP payload');
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeQuote(payload, fallbackName) {
  return {
    code: String(payload.fundcode ?? '').padStart(6, '0'),
    name: payload.name || fallbackName,
    navDate: payload.jzrq || null,
    nav: toNumber(payload.dwjz),
    estimatedNav: toNumber(payload.gsz),
    estimatedChangePct: toNumber(payload.gszzl),
    quoteTime: payload.gztime || null,
    source: SOURCE_HOST,
  };
}

export async function fetchFundQuote(fund, fetchImpl = fetch) {
  const expectedCode = String(fund.code).padStart(6, '0');
  const url = `https://${SOURCE_HOST}/js/${fund.code}.js?rt=${Date.now()}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: '*/*',
      'user-agent': 'fund-predictor/0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`Quote request failed for ${fund.code}: HTTP ${response.status}`);
  }
  const text = await response.text();
  const quote = normalizeQuote(parseFundJsonp(text), fund.fallbackName);
  if (quote.code !== expectedCode) {
    throw new Error(`Quote identity mismatch for ${fund.code}`);
  }
  return quote;
}
