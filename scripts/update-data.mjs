import { FUNDS, TIME_ZONE } from './funds.mjs';
import { fetchFundQuote } from './fund-quote.mjs';
import { predictFromQuote } from './predict.mjs';
import {
  backfillActualNavs,
  buildHistoryRecord,
  readJsonFile,
  upsertHistoryRecords,
  writeJsonFile,
} from './history-store.mjs';

const latestPath = new URL('../data/latest.json', import.meta.url);
const historyPath = new URL('../data/history.json', import.meta.url);

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

async function quoteOrError(fund) {
  try {
    return { ok: true, quote: await fetchFundQuote(fund) };
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
        error: error.message,
      },
    };
  }
}

async function main(now = new Date()) {
  const generatedAt = now.toISOString();
  const tradingDate = chinaDate(now);
  const previousHistory = await readJsonFile(historyPath, { version: 1, records: [] });
  const quoteResults = await Promise.all(FUNDS.map(quoteOrError));
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
    ? predictions.map((prediction) => buildHistoryRecord(tradingDate, generatedAt, prediction))
    : [];
  const history = upsertHistoryRecords(backfilledHistory, newRecords);

  const okCount = predictions.filter((prediction) => prediction.status === 'ok').length;
  const latest = {
    version: 1,
    generatedAt,
    timezone: TIME_ZONE,
    tradingDate,
    summary: shouldRecordPrediction
      ? `已生成 ${okCount}/${FUNDS.length} 只基金预测。`
      : '今天不是工作日，仅刷新最新可用数据。',
    funds: predictions,
  };

  await writeJsonFile(latestPath, latest);
  await writeJsonFile(historyPath, history);
  console.log(latest.summary);
}

await main();
