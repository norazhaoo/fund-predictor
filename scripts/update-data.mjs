import { FUNDS, TIME_ZONE } from './funds.mjs';
import { attachBenchmarkQuote, fetchBenchmarkQuotes } from './benchmark-quote.mjs';
import { fetchFundQuote } from './fund-quote.mjs';
import { fetchOfficialNav, mergeOfficialNav } from './official-nav.mjs';
import { predictFromProxy, predictFromQuote } from './predict.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  backfillActualNavs,
  buildHistoryRecord,
  readJsonFile,
  upsertHistoryRecords,
  writeJsonFile,
} from './history-store.mjs';

const defaultLatestPath = new URL('../data/latest.json', import.meta.url);
const defaultHistoryPath = new URL('../data/history.json', import.meta.url);
const DEFAULT_QUOTE_CONCURRENCY = 4;
const DEFAULT_OFFICIAL_CONCURRENCY = 6;
const LARGE_WATCHLIST_QUOTE_SPACING_MS = 250;
const DEFAULT_QUOTE_MAX_RETRIES = 2;
const DEFAULT_QUOTE_RETRY_BACKOFF_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function chinaDate(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isChinaWeekday(now) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(now);
  return !['Sat', 'Sun'].includes(weekday);
}

function quoteTimeDate(quoteTime) {
  if (typeof quoteTime !== 'string') {
    return null;
  }
  return quoteTime.match(/^(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
}

function isRecordablePrediction(prediction, tradingDate) {
  return prediction.status === 'ok'
    && Number.isFinite(prediction.predictedNav)
    && quoteTimeDate(prediction.quoteTime) === tradingDate;
}

function stalePredictionFromQuote(quote, tradingDate) {
  if (Number.isFinite(quote.estimatedNav)) {
    const prediction = predictFromQuote(quote, []);
    return {
      ...prediction,
      status: 'stale',
      message: [
        quote.quoteTime
          ? `上一交易日估算：估值时间 ${quote.quoteTime}，不是 ${tradingDate}。`
          : '估值时间不可用，按当前可见估值生成估算。',
        prediction.message,
      ].filter(Boolean).join(' '),
    };
  }

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

function errorPredictionFromQuote(quote) {
  return {
    ...quote,
    rawPredictedNav: null,
    predictedNav: null,
    predictedChangePct: null,
    calibration: 0,
    samplesUsed: 0,
    status: 'error',
    message: quote.error,
  };
}

function isQuoteUnavailableError(message) {
  return /暂无估值数据|Unable to parse fund JSONP payload/.test(String(message ?? ''));
}

function isRateLimitedQuoteError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /514|Frequency Capped|频率限制|rate.?limit/i.test(message);
}

async function quoteOrError(fund, fetchQuote, {
  maxRetries = DEFAULT_QUOTE_MAX_RETRIES,
  retryBackoffMs = DEFAULT_QUOTE_RETRY_BACKOFF_MS,
  sleepFn = sleep,
  waitForRequestTurn = async () => {},
  pauseRequests = async (ms) => {
    await sleepFn(ms);
  },
} = {}) {
  let attempt = 0;
  let needsRetryRequestTurn = false;
  try {
    while (true) {
      try {
        if (needsRetryRequestTurn) {
          await waitForRequestTurn();
        }
        return { ok: true, quote: await fetchQuote(fund) };
      } catch (error) {
        if (!isRateLimitedQuoteError(error) || attempt >= maxRetries) {
          throw error;
        }
        attempt += 1;
        await pauseRequests(retryBackoffMs * attempt);
        needsRetryRequestTurn = true;
      }
    }
  } catch (error) {
    return {
      ok: false,
      quote: {
        code: fund.code,
        name: fund.fallbackName,
        navDate: null,
        nav: null,
        estimatedNav: null,
        estimatedChangePct: null,
        quoteTime: null,
        source: 'fundgz.1234567.com.cn',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function officialNavOrNull(fund, fetchOfficial) {
  try {
    return await fetchOfficial(fund);
  } catch {
    return null;
  }
}

async function benchmarkQuotesOrEmpty(funds, fetchBenchmark) {
  try {
    return await fetchBenchmark(funds.map((fund) => fund.benchmark).filter(Boolean));
  } catch {
    return new Map();
  }
}

function createRequestStartGate({ requestSpacingMs = 0, sleepFn = sleep } = {}) {
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
          await sleepFn(spacing);
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
        await sleepFn(pauseMs);
      });
    },
  };
}

async function mapWithConcurrency(items, mapper, {
  concurrency = 1,
  requestSpacingMs = 0,
  sleepFn = sleep,
} = {}) {
  const results = Array.from({ length: items.length });
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const requestGate = createRequestStartGate({ requestSpacingMs, sleepFn });
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await requestGate.waitForRequestTurn();
      results[index] = await mapper(items[index], index, requestGate);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function runUpdate({
  now = new Date(),
  funds = FUNDS,
  fetchQuote = fetchFundQuote,
  fetchOfficial = fetchOfficialNav,
  fetchBenchmark = fetchBenchmarkQuotes,
  quoteConcurrency = DEFAULT_QUOTE_CONCURRENCY,
  officialConcurrency = DEFAULT_OFFICIAL_CONCURRENCY,
  quoteRequestSpacingMs = funds.length > 20 ? LARGE_WATCHLIST_QUOTE_SPACING_MS : 0,
  quoteMaxRetries = DEFAULT_QUOTE_MAX_RETRIES,
  quoteRetryBackoffMs = DEFAULT_QUOTE_RETRY_BACKOFF_MS,
  sleepFn = sleep,
  latestPath = defaultLatestPath,
  historyPath = defaultHistoryPath,
  writeSummary = () => {},
} = {}) {
  const generatedAt = now.toISOString();
  const tradingDate = chinaDate(now);
  const previousHistory = await readJsonFile(historyPath, { version: 1, records: [] });
  const [quoteResults, officialNavs, benchmarkQuotes] = await Promise.all([
    mapWithConcurrency(funds, (fund, index, requestGate) => quoteOrError(fund, fetchQuote, {
      maxRetries: quoteMaxRetries,
      retryBackoffMs: quoteRetryBackoffMs,
      sleepFn,
      waitForRequestTurn: requestGate.waitForRequestTurn,
      pauseRequests: requestGate.pauseRequests,
    }), {
      concurrency: quoteConcurrency,
      requestSpacingMs: quoteRequestSpacingMs,
      sleepFn,
    }),
    mapWithConcurrency(funds, (fund) => officialNavOrNull(fund, fetchOfficial), {
      concurrency: officialConcurrency,
      sleepFn,
    }),
    benchmarkQuotesOrEmpty(funds, fetchBenchmark),
  ]);
  const officialByCode = new Map(
    officialNavs
      .filter(Boolean)
      .map((nav) => [String(nav.code).padStart(6, '0'), nav]),
  );
  const quotes = quoteResults.map((result, index) => {
    const officialNav = officialByCode.get(String(result.quote.code).padStart(6, '0'));
    return attachBenchmarkQuote(mergeOfficialNav(result.quote, officialNav), funds[index], benchmarkQuotes);
  });
  const backfilledHistory = backfillActualNavs(previousHistory, quotes);

  const predictions = quotes.map((quote) => {
    if (quote.error) {
      const fallback = isQuoteUnavailableError(quote.error) ? predictFromProxy(quote) : null;
      return fallback ?? errorPredictionFromQuote(quote);
    }
    if (quoteTimeDate(quote.quoteTime) !== tradingDate) {
      return stalePredictionFromQuote(quote, tradingDate);
    }
    return predictFromQuote(quote, backfilledHistory.records);
  });

  const shouldRecordPrediction = isChinaWeekday(now);
  const newRecords = shouldRecordPrediction
    ? predictions
      .filter((prediction) => isRecordablePrediction(prediction, tradingDate))
      .map((prediction) => buildHistoryRecord(tradingDate, generatedAt, prediction))
    : [];
  const history = upsertHistoryRecords(backfilledHistory, newRecords);

  const okCount = predictions.filter((prediction) => prediction.status === 'ok').length;
  const proxyCount = predictions.filter((prediction) => prediction.status === 'proxy').length;
  const usableCount = okCount + proxyCount;
  const errorCount = predictions.filter((prediction) => prediction.status === 'error').length;
  const allFailed = errorCount === funds.length;
  const summary = allFailed
    ? '全部基金数据更新失败，已保留历史记录。'
    : shouldRecordPrediction
      ? `已生成 ${usableCount}/${funds.length} 只基金预测${proxyCount ? `，替代估算 ${proxyCount} 只。` : '。'}`
      : '今天不是工作日，仅刷新最新可用数据。';
  const latest = {
    version: 1,
    generatedAt,
    timezone: TIME_ZONE,
    tradingDate,
    summary,
    funds: predictions,
  };

  await writeJsonFile(latestPath, latest);
  await writeJsonFile(historyPath, history);
  writeSummary(latest.summary);
  return { latest, history };
}

export async function main(now = new Date()) {
  return runUpdate({ now, writeSummary: console.log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
