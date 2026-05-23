import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function round4(value) {
  return Number(value.toFixed(4));
}

export async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(path, value) {
  const filePath = path instanceof URL ? fileURLToPath(path) : path;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function buildHistoryRecord(date, generatedAt, prediction) {
  return {
    date,
    code: prediction.code,
    name: prediction.name,
    generatedAt,
    quoteTime: prediction.quoteTime,
    navDateAtPrediction: prediction.navDate,
    navAtPrediction: prediction.nav,
    estimateNav: prediction.estimatedNav,
    estimateChangePct: prediction.estimatedChangePct,
    predictedNav: prediction.predictedNav,
    predictedChangePct: prediction.predictedChangePct,
    calibration: prediction.calibration,
    samplesUsed: prediction.samplesUsed,
    status: prediction.status,
    actualNav: null,
    actualNavDate: null,
    error: null,
  };
}

export function upsertHistoryRecords(history, newRecords) {
  const byKey = new Map();
  for (const record of history.records ?? []) {
    byKey.set(`${record.date}:${record.code}`, record);
  }
  for (const record of newRecords) {
    byKey.set(`${record.date}:${record.code}`, record);
  }
  const records = [...byKey.values()].sort((a, b) => (
    a.date.localeCompare(b.date) || a.code.localeCompare(b.code)
  ));
  return { version: 1, records };
}

export function backfillActualNavs(history, quotes) {
  const quoteByCodeAndDate = new Map(
    quotes
      .filter((quote) => quote.code && quote.navDate && Number.isFinite(quote.nav))
      .map((quote) => [`${quote.code}:${quote.navDate}`, quote]),
  );

  const records = (history.records ?? []).map((record) => {
    if (Number.isFinite(record.actualNav)) {
      return record;
    }
    const quote = quoteByCodeAndDate.get(`${record.code}:${record.date}`);
    if (!quote || !Number.isFinite(record.predictedNav)) {
      return record;
    }
    return {
      ...record,
      actualNav: quote.nav,
      actualNavDate: quote.navDate,
      error: round4(quote.nav - record.predictedNav),
    };
  });

  return { version: 1, records };
}
