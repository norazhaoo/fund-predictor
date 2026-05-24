const SOURCE_HOST = 'qt.gtimg.cn';
const FIELD = {
  code: 2,
  price: 3,
  quoteTime: 30,
  change: 31,
  changePct: 32,
};

function toNumber(value) {
  if (value === null || value === undefined || value === '-' || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBenchmarkConfig(benchmark) {
  if (!benchmark?.secid) {
    return null;
  }
  const secid = String(benchmark.secid);
  const symbol = symbolForSecid(secid);
  if (!symbol) {
    return null;
  }
  return {
    secid,
    symbol,
    name: benchmark.name ?? '',
    sensitivity: Number.isFinite(benchmark.sensitivity) ? benchmark.sensitivity : 0,
  };
}

function symbolForSecid(secid) {
  if (/^[a-z]{2}/i.test(secid)) {
    return secid;
  }
  if (secid.toUpperCase() === '100.HSI') {
    return 'hkHSI';
  }
  const [market, code] = secid.split('.');
  if (!code) {
    return null;
  }
  if (market === '1') {
    return `sh${code}`;
  }
  if (market === '0') {
    return `sz${code}`;
  }
  if (market === '100') {
    return `hk${code}`;
  }
  return null;
}

function uniqueBenchmarks(benchmarks) {
  const bySecid = new Map();
  for (const benchmark of benchmarks.map(normalizeBenchmarkConfig).filter(Boolean)) {
    if (!bySecid.has(benchmark.secid)) {
      bySecid.set(benchmark.secid, benchmark);
    }
  }
  return [...bySecid.values()];
}

export function parseBenchmarkPayload(payload, benchmarks) {
  const text = typeof payload === 'string' ? payload : String(payload ?? '');
  const configs = new Map(uniqueBenchmarks(benchmarks).map((benchmark) => [benchmark.symbol, benchmark]));
  const quotes = new Map();

  for (const [, symbol, value] of text.matchAll(/v_([^=]+)="([^"]*)";?/g)) {
    const config = configs.get(symbol);
    if (!config) {
      continue;
    }
    const fields = value.split('~');
    const code = fields[FIELD.code] || config.secid.split('.').at(-1);
    quotes.set(config.secid, {
      secid: config.secid,
      code,
      name: config.name,
      price: toNumber(fields[FIELD.price]),
      changePct: toNumber(fields[FIELD.changePct]),
      change: toNumber(fields[FIELD.change]),
      sensitivity: config.sensitivity,
      source: SOURCE_HOST,
      quoteTime: fields[FIELD.quoteTime] || null,
    });
  }

  return quotes;
}

export async function fetchBenchmarkQuotes(benchmarks, fetchImpl = fetch) {
  const unique = uniqueBenchmarks(benchmarks);
  if (!unique.length) {
    return new Map();
  }

  const symbols = unique.map((benchmark) => benchmark.symbol).join(',');
  const url = `https://${SOURCE_HOST}/q=${symbols}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: '*/*',
      'user-agent': 'fund-predictor/0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`Benchmark request failed: HTTP ${response.status}`);
  }
  return parseBenchmarkPayload(await response.text(), unique);
}

export function attachBenchmarkQuote(quote, fund, benchmarkQuotes) {
  const benchmark = normalizeBenchmarkConfig(fund.benchmark);
  if (!benchmark) {
    return quote;
  }
  const benchmarkQuote = benchmarkQuotes.get(benchmark.secid);
  if (!benchmarkQuote) {
    return {
      ...quote,
      benchmark: {
        secid: benchmark.secid,
        name: benchmark.name,
        sensitivity: benchmark.sensitivity,
      },
      benchmarkSensitivity: benchmark.sensitivity,
    };
  }
  return {
    ...quote,
    benchmark: benchmarkQuote,
    benchmarkSensitivity: benchmarkQuote.sensitivity,
  };
}
