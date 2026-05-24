const SOURCE_HOST = 'fundgz.1234567.com.cn';
const DEFAULT_TIMEOUT_MS = 9000;

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round4(value) {
  return Number(value.toFixed(4));
}

function round2(value) {
  return Number(value.toFixed(2));
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

function stableString(value) {
  return String(value ?? '').trim().toLowerCase();
}

function statusRank(status) {
  return {
    ok: 0,
    stale: 1,
    error: 2,
  }[status] ?? 3;
}

function directionFactor(direction) {
  return direction === 'asc' ? 1 : -1;
}

function numericValue(fund, sortKey) {
  const value = fund[sortKey];
  return Number.isFinite(value) ? value : null;
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
  if (filter === 'positive') {
    return Number.isFinite(fund.predictedChangePct) && fund.predictedChangePct > 0;
  }
  if (filter === 'negative') {
    return Number.isFinite(fund.predictedChangePct) && fund.predictedChangePct < 0;
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
  };
}

export function predictLiveQuote(quote, historyRecords = [], tradingDate = '') {
  if (quoteTimeDate(quote.quoteTime) !== tradingDate) {
    return {
      ...quote,
      rawPredictedNav: null,
      predictedNav: null,
      predictedChangePct: null,
      calibration: 0,
      samplesUsed: 0,
      status: 'stale',
      message: quote.quoteTime
        ? `估值时间 ${quote.quoteTime} 不是 ${tradingDate}，暂不预测。`
        : '没有可用的盘中估值时间，暂不预测。',
    };
  }

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
  const predictedNav = round4(quote.estimatedNav + calibration);
  return {
    ...quote,
    rawPredictedNav: round4(quote.estimatedNav),
    predictedNav,
    predictedChangePct: predictedChangePctFor(predictedNav, quote),
    calibration,
    samplesUsed,
    status: 'ok',
    message: samplesUsed >= 5 ? '已使用历史误差做轻微校准。' : '历史样本不足，暂以盘中估值作为预测。',
  };
}

export function predictionErrorFor(fund, error) {
  return {
    code: String(fund.code).padStart(6, '0'),
    name: fund.fallbackName || fund.name || fund.code,
    navDate: null,
    nav: null,
    estimatedNav: null,
    estimatedChangePct: null,
    quoteTime: null,
    source: SOURCE_HOST,
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

      pending.set(code, { resolve, reject, cleanup, fund });
      script.onerror = () => {
        pending.delete(code);
        cleanup();
        reject(new Error(`估值请求失败：${code}`));
      };
      script.async = true;
      script.src = `https://${SOURCE_HOST}/js/${code}.js?rt=${now()}`;
      documentRef.head.append(script);
    });
  };
}

export async function refreshFundsInBatches({
  funds,
  fetchQuote,
  historyRecords = [],
  tradingDate,
  concurrency = 16,
  onProgress = () => {},
}) {
  const results = [];
  let nextIndex = 0;
  let completed = 0;
  let failed = 0;
  const workerCount = Math.max(1, Math.min(concurrency, funds.length));

  async function worker() {
    while (nextIndex < funds.length) {
      const fund = funds[nextIndex];
      nextIndex += 1;
      try {
        const quote = await fetchQuote(fund);
        results.push(predictLiveQuote(quote, historyRecords, tradingDate));
      } catch (error) {
        failed += 1;
        results.push(predictionErrorFor(fund, error));
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
