import { FUNDS, TIME_ZONE } from './funds.mjs';
import { fetchFundQuote } from './fund-quote.mjs';
import { predictFromQuote } from './predict.mjs';
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

async function quoteOrError(fund, fetchQuote) {
  try {
    return { ok: true, quote: await fetchQuote(fund) };
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

export async function runUpdate({
  now = new Date(),
  funds = FUNDS,
  fetchQuote = fetchFundQuote,
  latestPath = defaultLatestPath,
  historyPath = defaultHistoryPath,
  writeSummary = () => {},
} = {}) {
  const generatedAt = now.toISOString();
  const tradingDate = chinaDate(now);
  const previousHistory = await readJsonFile(historyPath, { version: 1, records: [] });
  const quoteResults = await Promise.all(funds.map((fund) => quoteOrError(fund, fetchQuote)));
  if (!quoteResults.some((result) => result.ok)) {
    throw new Error('All fund quote requests failed; preserving previous data.');
  }
  const quotes = quoteResults.map((result) => result.quote);
  const backfilledHistory = backfillActualNavs(previousHistory, quotes);

  const predictions = quotes.map((quote) => {
    if (quote.error) {
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
  const latest = {
    version: 1,
    generatedAt,
    timezone: TIME_ZONE,
    tradingDate,
    summary: shouldRecordPrediction
      ? `已生成 ${okCount}/${funds.length} 只基金预测。`
      : '今天不是工作日，仅刷新最新可用数据。',
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
