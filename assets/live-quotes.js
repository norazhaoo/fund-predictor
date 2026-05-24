const SOURCE_HOST = 'fundgz.1234567.com.cn';
const BENCHMARK_SOURCE_HOST = 'qt.gtimg.cn';
const OFFICIAL_NAV_SOURCE_HOST = 'fundf10.eastmoney.com';
const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_QUOTE_MAX_RETRIES = 2;
const DEFAULT_QUOTE_RETRY_BACKOFF_MS = 8000;
const MAX_ABS_BENCHMARK_ADJUSTMENT = 0.005;
const BENCHMARK_FIELD = {
  code: 2,
  price: 3,
  quoteTime: 30,
  change: 31,
  changePct: 32,
};

function defaultSleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
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

function round2(value) {
  return Number(value.toFixed(2));
}

function optionalProxySensitivity(benchmark) {
  return Number.isFinite(benchmark?.proxySensitivity)
    ? { proxySensitivity: benchmark.proxySensitivity }
    : {};
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
    ...optionalProxySensitivity(benchmark),
  };
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

function benchmarkQuoteFromValue(value, config) {
  const fields = String(value ?? '').split('~');
  const code = fields[BENCHMARK_FIELD.code] || config.secid.split('.').at(-1);
  return {
    secid: config.secid,
    code,
    name: config.name,
    price: toNumber(fields[BENCHMARK_FIELD.price]),
    changePct: toNumber(fields[BENCHMARK_FIELD.changePct]),
    change: toNumber(fields[BENCHMARK_FIELD.change]),
    sensitivity: config.sensitivity,
    ...optionalProxySensitivity(config),
    source: BENCHMARK_SOURCE_HOST,
    quoteTime: fields[BENCHMARK_FIELD.quoteTime] || null,
  };
}

function htmlDecode(value) {
  return String(value ?? '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function parseOfficialNavContent(content, code) {
  const row = htmlDecode(content).match(/<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/i)?.[1];
  if (!row) {
    throw new Error(`确认净值暂无数据：${code}`);
  }
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
  const nav = toNumber(cells[1]);
  if (!cells[0] || !Number.isFinite(nav)) {
    throw new Error(`确认净值数据不完整：${code}`);
  }
  return {
    code: String(code).padStart(6, '0'),
    navDate: cells[0],
    nav,
    dailyChangePct: toNumber(cells[3]),
    source: OFFICIAL_NAV_SOURCE_HOST,
  };
}

function quoteTimeDate(quoteTime) {
  if (typeof quoteTime !== 'string') {
    return null;
  }
  return quoteTime.match(/^(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
}

function predictedChangePctFor(predictedNav, quote) {
  if (!Number.isFinite(quote.nav) || quote.nav === 0) {
    return quote.estimatedChangePct;
  }
  return round2(((predictedNav - quote.nav) / quote.nav) * 100);
}

function calibrationFor(code, historyRecords) {
  const samples = historyRecords
    .filter((record) => record.code === code)
    .filter((record) => Number.isFinite(record.predictedNav) && Number.isFinite(record.actualNav))
    .slice(-20)
    .map((record) => record.actualNav - record.predictedNav);

  if (samples.length < 5) {
    return { calibration: 0, samplesUsed: samples.length };
  }

  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const capped = Math.max(-0.01, Math.min(0.01, average));
  return { calibration: round4(capped), samplesUsed: samples.length };
}

function benchmarkAdjustmentFor(quote) {
  if (
    !Number.isFinite(quote.nav)
    || !Number.isFinite(quote.estimatedChangePct)
    || !Number.isFinite(quote.benchmark?.changePct)
    || !Number.isFinite(quote.benchmarkSensitivity)
    || quote.benchmarkSensitivity <= 0
  ) {
    return { benchmarkAdjustment: 0, benchmarkGapPct: null };
  }

  const benchmarkGapPct = round2(quote.benchmark.changePct - quote.estimatedChangePct);
  const rawAdjustment = quote.nav * (benchmarkGapPct / 100) * quote.benchmarkSensitivity;
  const capped = Math.max(
    -MAX_ABS_BENCHMARK_ADJUSTMENT,
    Math.min(MAX_ABS_BENCHMARK_ADJUSTMENT, rawAdjustment),
  );
  return {
    benchmarkAdjustment: round4(capped),
    benchmarkGapPct,
  };
}

function stableString(value) {
  return String(value ?? '').trim().toLowerCase();
}

function statusRank(status) {
  return status === 'error' ? 1 : 0;
}

function directionFactor(direction) {
  return direction === 'asc' ? 1 : -1;
}

function numericValue(fund, sortKey) {
  const value = fund[sortKey];
  return Number.isFinite(value) ? value : null;
}

function filterChangePct(fund) {
  if (Number.isFinite(fund.predictedChangePct)) {
    return fund.predictedChangePct;
  }
  return Number.isFinite(fund.estimatedChangePct) ? fund.estimatedChangePct : null;
}

function compareNumber(a, b, sortKey, direction) {
  const left = numericValue(a, sortKey);
  const right = numericValue(b, sortKey);
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return (left - right) * directionFactor(direction);
}

function compareText(a, b, sortKey, direction) {
  return stableString(a[sortKey]).localeCompare(stableString(b[sortKey]), 'zh-CN') * directionFactor(direction);
}

function matchesQuery(fund, query) {
  const text = stableString(query);
  if (!text) {
    return true;
  }
  return [
    fund.code,
    fund.name,
    fund.fallbackName,
    fund.group,
  ].some((value) => stableString(value).includes(text));
}

function matchesFilter(fund, filter) {
  if (filter === 'holding') {
    return Boolean(fund.holding);
  }
  if (filter === 'watching') {
    return !fund.holding;
  }
  if (filter === 'error') {
    return fund.status === 'error';
  }
  if (filter === 'proxy') {
    return fund.status === 'proxy';
  }
  if (filter === 'positive') {
    return filterChangePct(fund) > 0;
  }
  if (filter === 'negative') {
    return filterChangePct(fund) < 0;
  }
  return true;
}

export function normalizeLiveQuotePayload(payload, fund) {
  return {
    code: String(payload.fundcode ?? fund.code ?? '').padStart(6, '0'),
    name: payload.name || fund.fallbackName || fund.name || fund.code,
    navDate: payload.jzrq || null,
    nav: toNumber(payload.dwjz),
    estimatedNav: toNumber(payload.gsz),
    estimatedChangePct: toNumber(payload.gszzl),
    quoteTime: payload.gztime || null,
    source: SOURCE_HOST,
    holding: Boolean(fund.holding),
    group: fund.group ?? '',
    order: Number.isFinite(fund.order) ? fund.order : 0,
    benchmark: fund.benchmark ?? null,
    benchmarkSensitivity: Number.isFinite(fund.benchmark?.sensitivity) ? fund.benchmark.sensitivity : 0,
  };
}

export function predictLiveQuote(quote, historyRecords = [], tradingDate = '') {
  if (!Number.isFinite(quote.estimatedNav)) {
    return {
      ...quote,
      rawPredictedNav: null,
      predictedNav: null,
      predictedChangePct: quote.estimatedChangePct,
      calibration: 0,
      samplesUsed: 0,
      status: 'stale',
      message: '没有可用的盘中估值，暂不预测。',
    };
  }

  const { calibration, samplesUsed } = calibrationFor(quote.code, historyRecords);
  const { benchmarkAdjustment, benchmarkGapPct } = benchmarkAdjustmentFor(quote);
  const predictedNav = round4(quote.estimatedNav + calibration + benchmarkAdjustment);
  const hasBenchmarkAdjustment = benchmarkAdjustment !== 0;
  const quoteDate = quoteTimeDate(quote.quoteTime);
  const isCurrentTradingDate = quoteDate === tradingDate;
  return {
    ...quote,
    rawPredictedNav: round4(quote.estimatedNav),
    predictedNav,
    predictedChangePct: predictedChangePctFor(predictedNav, quote),
    calibration,
    benchmarkAdjustment,
    benchmarkGapPct,
    samplesUsed,
    status: isCurrentTradingDate ? 'ok' : 'stale',
    message: [
      isCurrentTradingDate
        ? ''
        : quote.quoteTime
          ? `上一交易日估算：估值时间 ${quote.quoteTime}，不是 ${tradingDate}。`
          : '估值时间不可用，按当前可见估值生成估算。',
      samplesUsed >= 5 ? '已使用历史误差做轻微校准。' : '历史样本不足，暂以盘中估值作为预测。',
      hasBenchmarkAdjustment ? '已加入参考指数偏离修正。' : '',
    ].filter(Boolean).join(' '),
  };
}

export function predictionErrorFor(fund, error) {
  return {
    code: String(fund.code).padStart(6, '0'),
    name: fund.fallbackName || fund.name || fund.code,
    navDate: fund.navDate ?? null,
    nav: Number.isFinite(fund.nav) ? fund.nav : null,
    estimatedNav: null,
    estimatedChangePct: null,
    quoteTime: null,
    source: SOURCE_HOST,
    benchmark: fund.benchmark ?? null,
    benchmarkSensitivity: Number.isFinite(fund.benchmark?.sensitivity)
      ? fund.benchmark.sensitivity
      : Number.isFinite(fund.benchmarkSensitivity)
        ? fund.benchmarkSensitivity
        : 0,
    rawPredictedNav: null,
    predictedNav: null,
    predictedChangePct: null,
    calibration: 0,
    samplesUsed: 0,
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    holding: Boolean(fund.holding),
    group: fund.group ?? '',
    order: Number.isFinite(fund.order) ? fund.order : 0,
  };
}

function isQuoteUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /暂无估值数据|Unable to parse fund JSONP payload/.test(message);
}

function isRateLimitedQuoteError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /514|Frequency Capped|频率限制|rate.?limit/i.test(message);
}

function proxySensitivityFor(quote) {
  if (Number.isFinite(quote.benchmark?.proxySensitivity)) {
    return quote.benchmark.proxySensitivity;
  }
  return 1;
}

export function proxyPredictionFor(quote, error) {
  if (error !== undefined && !isQuoteUnavailableError(error)) {
    return null;
  }
  if (!Number.isFinite(quote.nav) || !Number.isFinite(quote.benchmark?.changePct)) {
    return null;
  }

  const proxySensitivity = proxySensitivityFor(quote);
  const proxyChangePct = round2(quote.benchmark.changePct * proxySensitivity);
  const predictedNav = round4(quote.nav * (1 + proxyChangePct / 100));
  const benchmarkName = quote.benchmark.name || '参考行情';

  return {
    ...quote,
    code: String(quote.code).padStart(6, '0'),
    name: quote.name || quote.fallbackName || quote.code,
    source: `proxy:${quote.benchmark.source ?? BENCHMARK_SOURCE_HOST}`,
    estimatedNav: null,
    estimatedChangePct: null,
    quoteTime: quote.quoteTime ?? quote.benchmark.quoteTime ?? null,
    rawPredictedNav: predictedNav,
    predictedNav,
    predictedChangePct: predictedChangePctFor(predictedNav, { ...quote, estimatedChangePct: proxyChangePct }),
    calibration: 0,
    benchmarkAdjustment: 0,
    benchmarkGapPct: null,
    samplesUsed: 0,
    proxyChangePct,
    proxySensitivity,
    predictionMethod: 'benchmark-proxy',
    confidence: 'low',
    status: 'proxy',
    message: `天天基金暂无盘中估值，已用${benchmarkName}做低置信替代估算。`,
  };
}

export function buildRefreshProgress({ completed, total, failed }) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const safeFailed = Math.max(0, failed);
  const isComplete = safeTotal > 0 && safeCompleted >= safeTotal;
  const ok = Math.max(0, safeCompleted - safeFailed);
  let text = isComplete
    ? `全量刷新完成：${safeCompleted}/${safeTotal}`
    : `正在全量刷新：${safeCompleted}/${safeTotal}`;

  if (isComplete && safeFailed > 0) {
    text = `全量刷新完成：${ok}/${safeTotal}，失败 ${safeFailed} 只`;
  }

  return {
    completed: safeCompleted,
    total: safeTotal,
    failed: safeFailed,
    isComplete,
    text,
  };
}

export function shouldPublishLiveRanking(progress) {
  return Boolean(progress?.isComplete && progress.failed < progress.total);
}

export function sortFundsForView(funds, {
  sortKey = 'predictedChangePct',
  direction = 'desc',
  query = '',
  filter = 'all',
} = {}) {
  return funds
    .filter((fund) => matchesQuery(fund, query))
    .filter((fund) => matchesFilter(fund, filter))
    .toSorted((a, b) => {
      const statusDelta = statusRank(a.status) - statusRank(b.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      if (sortKey === 'code' || sortKey === 'name' || sortKey === 'quoteTime') {
        const textDelta = compareText(a, b, sortKey, direction);
        if (textDelta !== 0) {
          return textDelta;
        }
      } else if (sortKey === 'custom') {
        const orderDelta = compareNumber(a, b, 'order', 'asc');
        if (orderDelta !== 0) {
          return orderDelta;
        }
      } else {
        const numberDelta = compareNumber(a, b, sortKey, direction);
        if (numberDelta !== 0) {
          return numberDelta;
        }
      }

      const holdingDelta = Number(b.holding) - Number(a.holding);
      if (holdingDelta !== 0) {
        return holdingDelta;
      }
      return compareText(a, b, 'code', 'asc');
    });
}

export function mergeCatalogMetadata(funds, catalogFunds) {
  const byCode = new Map(catalogFunds.map((fund) => [String(fund.code).padStart(6, '0'), fund]));
  return funds.map((fund) => {
    const catalogFund = byCode.get(String(fund.code).padStart(6, '0')) ?? {};
    return {
      ...fund,
      holding: Boolean(catalogFund.holding ?? fund.holding),
      group: catalogFund.group ?? fund.group ?? '',
      order: Number.isFinite(catalogFund.order) ? catalogFund.order : Number.isFinite(fund.order) ? fund.order : 0,
    };
  });
}

export function mergeNewerOfficialNav(liveFunds, previousFunds) {
  const previousByCode = new Map(previousFunds.map((fund) => [String(fund.code).padStart(6, '0'), fund]));
  return liveFunds.map((fund) => {
    const previous = previousByCode.get(String(fund.code).padStart(6, '0'));
    if (!previous?.navDate || !Number.isFinite(previous.nav) || !fund.navDate || fund.navDate >= previous.navDate) {
      return fund;
    }
    return {
      ...fund,
      navDate: previous.navDate,
      nav: previous.nav,
      officialChangePct: previous.officialChangePct,
      officialNavSource: previous.officialNavSource,
    };
  });
}

export function carryForwardBenchmarkQuotes(catalogFunds, previousFunds) {
  const previousByCode = new Map(previousFunds.map((fund) => [String(fund.code).padStart(6, '0'), fund]));
  return catalogFunds.map((fund) => {
    const previous = previousByCode.get(String(fund.code).padStart(6, '0'));
    const previousBenchmark = previous?.benchmark;
    if (!Number.isFinite(previousBenchmark?.changePct)) {
      return fund;
    }
    return {
      ...fund,
      benchmark: {
        ...fund.benchmark,
        ...previousBenchmark,
      },
      benchmarkSensitivity: Number.isFinite(previous.benchmarkSensitivity)
        ? previous.benchmarkSensitivity
        : previousBenchmark.sensitivity,
    };
  });
}

export function carryForwardQuoteSnapshot(catalogFunds, previousFunds) {
  const previousByCode = new Map(previousFunds.map((fund) => [String(fund.code).padStart(6, '0'), fund]));
  return catalogFunds.map((fund) => {
    const previous = previousByCode.get(String(fund.code).padStart(6, '0'));
    if (!previous) {
      return fund;
    }
    return {
      ...fund,
      name: previous.name ?? fund.fallbackName ?? fund.name,
      navDate: previous.navDate ?? fund.navDate ?? null,
      nav: Number.isFinite(previous.nav) ? previous.nav : fund.nav,
      officialChangePct: previous.officialChangePct,
      officialNavSource: previous.officialNavSource,
    };
  });
}

export function applyBenchmarkQuotes(funds, benchmarkQuotes) {
  return funds.map((fund) => {
    const benchmark = normalizeBenchmarkConfig(fund.benchmark);
    if (!benchmark) {
      return fund;
    }
    const benchmarkQuote = benchmarkQuotes.get(benchmark.secid);
    if (!benchmarkQuote) {
      return {
        ...fund,
        benchmark: {
          ...fund.benchmark,
          secid: benchmark.secid,
          name: benchmark.name,
          sensitivity: benchmark.sensitivity,
          ...optionalProxySensitivity(benchmark),
        },
        benchmarkSensitivity: benchmark.sensitivity,
      };
    }
    return {
      ...fund,
      benchmark: {
        ...benchmarkQuote,
        ...optionalProxySensitivity(benchmarkQuote),
      },
      benchmarkSensitivity: benchmarkQuote.sensitivity,
    };
  });
}

export function createBenchmarkScriptFetcher({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  return function fetchBenchmarkQuotes(benchmarks) {
    const unique = uniqueBenchmarks(benchmarks);
    if (!unique.length) {
      return Promise.resolve(new Map());
    }

    return new Promise((resolve, reject) => {
      const script = documentRef.createElement('script');
      const timeout = windowRef.setTimeout(() => {
        cleanup();
        reject(new Error('参考行情请求超时'));
      }, timeoutMs);

      function cleanup() {
        windowRef.clearTimeout(timeout);
        script.remove();
      }

      script.onload = () => {
        const quotes = new Map();
        for (const config of unique) {
          const value = windowRef[`v_${config.symbol}`];
          if (value) {
            quotes.set(config.secid, benchmarkQuoteFromValue(value, config));
          }
        }
        cleanup();
        resolve(quotes);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error('参考行情请求失败'));
      };
      script.async = true;
      script.src = `https://${BENCHMARK_SOURCE_HOST}/q=${unique.map((benchmark) => benchmark.symbol).join(',')}&_=${now()}`;
      documentRef.head.append(script);
    });
  };
}

export function createOfficialNavScriptFetcher({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  let chain = Promise.resolve();

  function loadOfficialNav(fund) {
    const code = String(fund.code).padStart(6, '0');
    return new Promise((resolve, reject) => {
      const script = documentRef.createElement('script');
      const timeout = windowRef.setTimeout(() => {
        cleanup();
        reject(new Error(`确认净值请求超时：${code}`));
      }, timeoutMs);

      function cleanup() {
        windowRef.clearTimeout(timeout);
        script.remove();
      }

      windowRef.apidata = undefined;
      script.onload = () => {
        try {
          const nav = parseOfficialNavContent(windowRef.apidata?.content, code);
          cleanup();
          resolve({
            code: nav.code,
            navDate: nav.navDate,
            nav: nav.nav,
            officialChangePct: nav.dailyChangePct,
            officialNavSource: nav.source,
          });
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      script.onerror = () => {
        cleanup();
        reject(new Error(`确认净值请求失败：${code}`));
      };
      script.async = true;
      script.src = `https://${OFFICIAL_NAV_SOURCE_HOST}/F10DataApi.aspx?type=lsjz&code=${code}&page=1&per=1&rt=${now()}`;
      documentRef.head.append(script);
    });
  }

  return function fetchOfficialNav(fund) {
    const next = chain.then(() => loadOfficialNav(fund), () => loadOfficialNav(fund));
    chain = next.catch(() => {});
    return next;
  };
}

export function createJsonpQuoteFetcher({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const pending = new Map();
  const previousCallback = windowRef.jsonpgz;

  windowRef.jsonpgz = (payload) => {
    const code = String(payload?.fundcode ?? '').padStart(6, '0');
    const entry = pending.get(code);
    if (!entry) {
      if (typeof previousCallback === 'function') {
        previousCallback(payload);
      }
      return;
    }
    pending.delete(code);
    entry.cleanup();
    entry.resolve(normalizeLiveQuotePayload(payload, entry.fund));
  };

  return function fetchLiveQuote(fund) {
    const code = String(fund.code).padStart(6, '0');
    return new Promise((resolve, reject) => {
      const script = documentRef.createElement('script');
      const timeout = windowRef.setTimeout(() => {
        pending.delete(code);
        cleanup();
        reject(new Error(`估值请求超时：${code}`));
      }, timeoutMs);

      function cleanup() {
        windowRef.clearTimeout(timeout);
        script.remove();
      }

      function rejectPending(message) {
        const entry = pending.get(code);
        if (!entry) {
          return;
        }
        pending.delete(code);
        cleanup();
        entry.reject(new Error(message));
      }

      pending.set(code, { resolve, reject, cleanup, fund });
      script.onload = () => {
        rejectPending(`暂无估值数据：${code}`);
      };
      script.onerror = () => {
        rejectPending(`估值请求失败：${code}（可能触发接口频率限制）`);
      };
      script.async = true;
      script.src = `https://${SOURCE_HOST}/js/${code}.js?rt=${now()}`;
      documentRef.head.append(script);
    });
  };
}

function createRequestStartGate({ requestSpacingMs = 0, sleep = defaultSleep } = {}) {
  let chain = Promise.resolve();
  let hasStarted = false;
  const spacing = Math.max(0, requestSpacingMs);

  function enqueue(task) {
    const next = chain.then(task, task);
    chain = next.catch(() => {});
    return next;
  }

  return {
    waitForRequestTurn() {
      return enqueue(async () => {
        if (hasStarted && spacing > 0) {
          await sleep(spacing);
        }
        hasStarted = true;
      });
    },
    pauseRequests(ms) {
      const pauseMs = Math.max(0, ms);
      if (pauseMs === 0) {
        return enqueue(async () => {});
      }
      return enqueue(async () => {
        await sleep(pauseMs);
      });
    },
  };
}

export async function refreshFundsInBatches({
  funds,
  fetchQuote,
  historyRecords = [],
  tradingDate,
  concurrency = 16,
  requestSpacingMs = 0,
  sleep = defaultSleep,
  quoteMaxRetries = DEFAULT_QUOTE_MAX_RETRIES,
  quoteRetryBackoffMs = DEFAULT_QUOTE_RETRY_BACKOFF_MS,
  fetchProxyBase = async () => null,
  onProgress = () => {},
}) {
  const results = [];
  let nextIndex = 0;
  let completed = 0;
  let failed = 0;
  const workerCount = Math.max(1, Math.min(concurrency, funds.length));
  const requestGate = createRequestStartGate({ requestSpacingMs, sleep });

  async function fetchQuoteWithRetry(fund) {
    let attempt = 0;
    while (true) {
      try {
        await requestGate.waitForRequestTurn();
        return await fetchQuote(fund);
      } catch (error) {
        if (!isRateLimitedQuoteError(error) || attempt >= quoteMaxRetries) {
          throw error;
        }
        attempt += 1;
        await requestGate.pauseRequests(quoteRetryBackoffMs * attempt);
      }
    }
  }

  async function worker() {
    while (nextIndex < funds.length) {
      const fund = funds[nextIndex];
      nextIndex += 1;
      try {
        const quote = await fetchQuoteWithRetry(fund);
        results.push(predictLiveQuote(quote, historyRecords, tradingDate));
      } catch (error) {
        let fallbackBase = null;
        if (isQuoteUnavailableError(error) && !Number.isFinite(fund.nav)) {
          try {
            fallbackBase = await fetchProxyBase(fund, error);
          } catch {
            fallbackBase = null;
          }
        }
        const fallback = proxyPredictionFor({ ...fund, ...fallbackBase }, error);
        if (fallback) {
          results.push(fallback);
        } else {
          failed += 1;
          results.push(predictionErrorFor(fund, error));
        }
      } finally {
        completed += 1;
        onProgress(buildRefreshProgress({ completed, total: funds.length, failed }));
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return {
    progress: buildRefreshProgress({ completed, total: funds.length, failed }),
    funds: results,
  };
}
