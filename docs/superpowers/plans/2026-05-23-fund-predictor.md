# Fund Predictor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, phone-friendly GitHub Pages dashboard that updates daily at 14:30 Beijing time with estimated closing NAV predictions for four watched funds.

**Architecture:** Use a no-build static site plus Node scripts. The Node updater fetches fund estimate JSONP, normalizes quote data, creates predictions, backfills actual NAV values from later official data, and writes compact JSON files. The browser app loads those JSON files and renders a mobile dashboard.

**Tech Stack:** Node.js 22 built-ins (`fetch`, `node:test`, `fs/promises`), vanilla HTML/CSS/JavaScript, GitHub Actions, GitHub Pages.

---

## File Structure

- Create `package.json`: npm scripts for tests and data update.
- Create `scripts/funds.mjs`: watched fund list and timezone constants.
- Create `scripts/fund-quote.mjs`: JSONP parsing, quote normalization, live quote fetch.
- Create `scripts/predict.mjs`: transparent prediction and calibration logic.
- Create `scripts/history-store.mjs`: read/write JSON, dedupe daily records, backfill official NAV values.
- Create `scripts/update-data.mjs`: command-line updater that writes `data/latest.json` and `data/history.json`.
- Create `data/latest.json`: initial site data for first load before the first scheduled run.
- Create `data/history.json`: initial empty history.
- Create `index.html`: mobile-first static page shell.
- Create `assets/app.css`: responsive mobile dashboard styling.
- Create `assets/app.js`: browser renderer for latest and history JSON.
- Create `tests/*.test.mjs`: fixture-based coverage for parser, predictor, history, and static app references.
- Create `.github/workflows/update-fund-data.yml`: scheduled updater and commit workflow.
- Create `.github/workflows/deploy-pages.yml`: static GitHub Pages deployment workflow.

---

## Task 1: Project Skeleton And Fund Metadata

**Files:**
- Create: `package.json`
- Create: `scripts/funds.mjs`
- Create: `data/latest.json`
- Create: `data/history.json`
- Test: `tests/funds.test.mjs`

- [ ] **Step 1: Write the fund metadata test**

Create `tests/funds.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNDS, TIME_ZONE } from '../scripts/funds.mjs';

test('watched funds contain the four selected fund codes', () => {
  assert.deepEqual(
    FUNDS.map((fund) => fund.code),
    ['019633', '016874', '020744', '015903'],
  );
});

test('fund metadata uses Beijing timezone for scheduling and display', () => {
  assert.equal(TIME_ZONE, 'Asia/Shanghai');
  assert.ok(FUNDS.every((fund) => /^\d{6}$/.test(fund.code)));
});
```

- [ ] **Step 2: Run the metadata test to verify it fails**

Run: `node --test tests/funds.test.mjs`

Expected: FAIL with module not found for `../scripts/funds.mjs`.

- [ ] **Step 3: Add package scripts and fund metadata**

Create `package.json`:

```json
{
  "name": "fund-predictor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "update": "node scripts/update-data.mjs"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Create `scripts/funds.mjs`:

```js
export const TIME_ZONE = 'Asia/Shanghai';

export const FUNDS = Object.freeze([
  { code: '019633', fallbackName: '国泰半导体设备ETF联接C' },
  { code: '016874', fallbackName: '广发远见智选混合C' },
  { code: '020744', fallbackName: '广发恒生消费ETF联接(QDII)C' },
  { code: '015903', fallbackName: '博时优质精选混合C' },
]);
```

Create `data/latest.json`:

```json
{
  "version": 1,
  "generatedAt": null,
  "timezone": "Asia/Shanghai",
  "tradingDate": null,
  "summary": "还没有生成预测数据。",
  "funds": []
}
```

Create `data/history.json`:

```json
{
  "version": 1,
  "records": []
}
```

- [ ] **Step 4: Run metadata test to verify it passes**

Run: `node --test tests/funds.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit skeleton**

```bash
git add package.json scripts/funds.mjs data/latest.json data/history.json tests/funds.test.mjs
git commit -m "feat: add fund predictor project skeleton"
```

---

## Task 2: Quote Parsing And Prediction Logic

**Files:**
- Create: `scripts/fund-quote.mjs`
- Create: `scripts/predict.mjs`
- Test: `tests/fund-quote.test.mjs`
- Test: `tests/predict.test.mjs`

- [ ] **Step 1: Write quote parser tests**

Create `tests/fund-quote.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFundJsonp, normalizeQuote } from '../scripts/fund-quote.mjs';

const jsonp = 'jsonpgz({"fundcode":"019633","name":"国泰半导体设备ETF联接C","jzrq":"2026-05-22","dwjz":"2.5314","gsz":"2.5534","gszzl":"0.87","gztime":"2026-05-23 14:30"});';

test('parseFundJsonp parses Eastmoney-style JSONP payload', () => {
  assert.deepEqual(parseFundJsonp(jsonp), {
    fundcode: '019633',
    name: '国泰半导体设备ETF联接C',
    jzrq: '2026-05-22',
    dwjz: '2.5314',
    gsz: '2.5534',
    gszzl: '0.87',
    gztime: '2026-05-23 14:30',
  });
});

test('normalizeQuote converts numeric strings and keeps source fields', () => {
  assert.deepEqual(normalizeQuote(parseFundJsonp(jsonp), 'fallback'), {
    code: '019633',
    name: '国泰半导体设备ETF联接C',
    navDate: '2026-05-22',
    nav: 2.5314,
    estimatedNav: 2.5534,
    estimatedChangePct: 0.87,
    quoteTime: '2026-05-23 14:30',
    source: 'fundgz.1234567.com.cn',
  });
});

test('normalizeQuote falls back to configured name when payload name is missing', () => {
  const quote = normalizeQuote({ fundcode: '015903', dwjz: '1.4808' }, '博时优质精选混合C');
  assert.equal(quote.name, '博时优质精选混合C');
  assert.equal(quote.estimatedNav, null);
});

test('parseFundJsonp rejects malformed payloads', () => {
  assert.throws(() => parseFundJsonp('not-jsonp'), /Unable to parse fund JSONP/);
});
```

- [ ] **Step 2: Write prediction tests**

Create `tests/predict.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { predictFromQuote } from '../scripts/predict.mjs';

const quote = {
  code: '019633',
  name: '国泰半导体设备ETF联接C',
  navDate: '2026-05-22',
  nav: 2.5314,
  estimatedNav: 2.5534,
  estimatedChangePct: 0.87,
  quoteTime: '2026-05-23 14:30',
  source: 'fundgz.1234567.com.cn',
};

test('predictFromQuote uses the intraday estimate as baseline with no history', () => {
  const prediction = predictFromQuote(quote, []);
  assert.equal(prediction.predictedNav, 2.5534);
  assert.equal(prediction.rawPredictedNav, 2.5534);
  assert.equal(prediction.calibration, 0);
  assert.equal(prediction.samplesUsed, 0);
  assert.equal(prediction.status, 'ok');
});

test('predictFromQuote applies capped historical calibration after enough samples', () => {
  const history = [
    { code: '019633', predictedNav: 2.1, actualNav: 2.11 },
    { code: '019633', predictedNav: 2.2, actualNav: 2.21 },
    { code: '019633', predictedNav: 2.3, actualNav: 2.31 },
    { code: '019633', predictedNav: 2.4, actualNav: 2.41 },
    { code: '019633', predictedNav: 2.5, actualNav: 2.51 },
  ];
  const prediction = predictFromQuote(quote, history);
  assert.equal(prediction.samplesUsed, 5);
  assert.equal(prediction.calibration, 0.01);
  assert.equal(prediction.predictedNav, 2.5634);
});

test('predictFromQuote returns stale status when no intraday estimate exists', () => {
  const prediction = predictFromQuote({ ...quote, estimatedNav: null }, []);
  assert.equal(prediction.status, 'stale');
  assert.equal(prediction.predictedNav, null);
  assert.match(prediction.message, /没有可用的盘中估值/);
});
```

- [ ] **Step 3: Run parser and prediction tests to verify they fail**

Run: `node --test tests/fund-quote.test.mjs tests/predict.test.mjs`

Expected: FAIL with module not found for `scripts/fund-quote.mjs` and `scripts/predict.mjs`.

- [ ] **Step 4: Implement quote parsing and fetching**

Create `scripts/fund-quote.mjs`:

```js
const SOURCE_HOST = 'fundgz.1234567.com.cn';

export function parseFundJsonp(text) {
  const match = text.match(/^[\w$]+\((.*)\);?$/s);
  if (!match) {
    throw new Error('Unable to parse fund JSONP payload');
  }
  return JSON.parse(match[1]);
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
  return normalizeQuote(parseFundJsonp(text), fund.fallbackName);
}
```

- [ ] **Step 5: Implement prediction logic**

Create `scripts/predict.mjs`:

```js
const MIN_CALIBRATION_SAMPLES = 5;
const MAX_ABS_CALIBRATION = 0.01;

function round4(value) {
  return Number(value.toFixed(4));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calibrationFor(code, historyRecords) {
  const samples = historyRecords
    .filter((record) => record.code === code)
    .filter((record) => Number.isFinite(record.predictedNav) && Number.isFinite(record.actualNav))
    .slice(-20)
    .map((record) => record.actualNav - record.predictedNav);

  if (samples.length < MIN_CALIBRATION_SAMPLES) {
    return { calibration: 0, samplesUsed: samples.length };
  }

  const rawCalibration = average(samples);
  const capped = Math.max(-MAX_ABS_CALIBRATION, Math.min(MAX_ABS_CALIBRATION, rawCalibration));
  return { calibration: round4(capped), samplesUsed: samples.length };
}

export function predictFromQuote(quote, historyRecords) {
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
    predictedChangePct: quote.estimatedChangePct,
    calibration,
    samplesUsed,
    status: 'ok',
    message: samplesUsed >= MIN_CALIBRATION_SAMPLES
      ? '已使用历史误差做轻微校准。'
      : '历史样本不足，暂以盘中估值作为预测。',
  };
}
```

- [ ] **Step 6: Run parser and prediction tests to verify they pass**

Run: `node --test tests/fund-quote.test.mjs tests/predict.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit quote and prediction modules**

```bash
git add scripts/fund-quote.mjs scripts/predict.mjs tests/fund-quote.test.mjs tests/predict.test.mjs
git commit -m "feat: add fund quote parsing and prediction"
```

---

## Task 3: Data Update Pipeline And History Backfill

**Files:**
- Create: `scripts/history-store.mjs`
- Create: `scripts/update-data.mjs`
- Test: `tests/history-store.test.mjs`

- [ ] **Step 1: Write history store tests**

Create `tests/history-store.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryRecord,
  upsertHistoryRecords,
  backfillActualNavs,
} from '../scripts/history-store.mjs';

const prediction = {
  code: '019633',
  name: '国泰半导体设备ETF联接C',
  navDate: '2026-05-22',
  nav: 2.5314,
  estimatedNav: 2.5534,
  estimatedChangePct: 0.87,
  quoteTime: '2026-05-23 14:30',
  predictedNav: 2.5534,
  predictedChangePct: 0.87,
  calibration: 0,
  samplesUsed: 0,
  status: 'ok',
  message: '历史样本不足，暂以盘中估值作为预测。',
  source: 'fundgz.1234567.com.cn',
};

test('buildHistoryRecord stores compact daily prediction fields', () => {
  assert.deepEqual(buildHistoryRecord('2026-05-23', '2026-05-23T06:30:00.000Z', prediction), {
    date: '2026-05-23',
    code: '019633',
    name: '国泰半导体设备ETF联接C',
    generatedAt: '2026-05-23T06:30:00.000Z',
    quoteTime: '2026-05-23 14:30',
    navDateAtPrediction: '2026-05-22',
    navAtPrediction: 2.5314,
    estimateNav: 2.5534,
    estimateChangePct: 0.87,
    predictedNav: 2.5534,
    predictedChangePct: 0.87,
    calibration: 0,
    samplesUsed: 0,
    status: 'ok',
    actualNav: null,
    actualNavDate: null,
    error: null,
  });
});

test('upsertHistoryRecords replaces same date and code instead of duplicating', () => {
  const original = buildHistoryRecord('2026-05-23', 'old', prediction);
  const replacement = buildHistoryRecord('2026-05-23', 'new', { ...prediction, predictedNav: 2.56 });
  const history = upsertHistoryRecords({ version: 1, records: [original] }, [replacement]);
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].generatedAt, 'new');
  assert.equal(history.records[0].predictedNav, 2.56);
});

test('backfillActualNavs fills official NAV and prediction error when quote nav date matches', () => {
  const record = buildHistoryRecord('2026-05-23', 'run', prediction);
  const history = { version: 1, records: [record] };
  const quotes = [{ code: '019633', navDate: '2026-05-23', nav: 2.561 }];
  const updated = backfillActualNavs(history, quotes);
  assert.equal(updated.records[0].actualNav, 2.561);
  assert.equal(updated.records[0].actualNavDate, '2026-05-23');
  assert.equal(updated.records[0].error, 0.0076);
});
```

- [ ] **Step 2: Run history tests to verify they fail**

Run: `node --test tests/history-store.test.mjs`

Expected: FAIL with module not found for `scripts/history-store.mjs`.

- [ ] **Step 3: Implement history storage helpers**

Create `scripts/history-store.mjs`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  await mkdir(dirname(path), { recursive: true });
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
```

- [ ] **Step 4: Implement update command**

Create `scripts/update-data.mjs`:

```js
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
```

- [ ] **Step 5: Run history tests to verify they pass**

Run: `node --test tests/history-store.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run full unit suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Smoke-test live update manually**

Run: `npm run update`

Expected: command exits 0 and prints a Chinese summary such as `已生成 4/4 只基金预测。` or a partial count if the public quote endpoint is unavailable. `data/latest.json` and `data/history.json` should be valid JSON.

- [ ] **Step 8: Commit data pipeline**

```bash
git add scripts/history-store.mjs scripts/update-data.mjs tests/history-store.test.mjs data/latest.json data/history.json
git commit -m "feat: add fund data update pipeline"
```

---

## Task 4: Mobile Static Dashboard

**Files:**
- Create: `index.html`
- Create: `assets/app.css`
- Create: `assets/app.js`
- Test: `tests/static-smoke.test.mjs`

- [ ] **Step 1: Write static smoke test**

Create `tests/static-smoke.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('index references the dashboard assets and root element', async () => {
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /<div id="app"/);
  assert.match(html, /assets\/app\.css/);
  assert.match(html, /assets\/app\.js/);
});

test('browser app fetches latest and history JSON with relative paths', async () => {
  const js = await readFile('assets/app.js', 'utf8');
  assert.match(js, /fetch\('data\/latest\.json'/);
  assert.match(js, /fetch\('data\/history\.json'/);
});
```

- [ ] **Step 2: Run static smoke test to verify it fails**

Run: `node --test tests/static-smoke.test.mjs`

Expected: FAIL with `ENOENT` for `index.html`.

- [ ] **Step 3: Create page shell**

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>基金收盘估算</title>
    <link rel="stylesheet" href="assets/app.css">
  </head>
  <body>
    <main id="app" class="app-shell">
      <section class="hero">
        <p class="eyebrow">14:30 估算</p>
        <h1>基金收盘估算</h1>
        <p class="summary">正在加载最新数据...</p>
      </section>
    </main>
    <script type="module" src="assets/app.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create mobile styles**

Create `assets/app.css`:

```css
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #1e2732;
  --muted: #687385;
  --line: #dfe5ec;
  --blue: #1677ff;
  --green: #0f9f6e;
  --red: #d9364e;
  --amber: #a96500;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.app-shell {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 18px 14px 32px;
}

.hero {
  padding: 20px 2px 14px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--blue);
  font-size: 13px;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
  letter-spacing: 0;
}

.summary,
.disclaimer,
.meta {
  color: var(--muted);
  line-height: 1.55;
}

.summary {
  margin: 10px 0 0;
  font-size: 15px;
}

.fund-list,
.history-list {
  display: grid;
  gap: 10px;
}

.fund-card,
.history-card,
.notice {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.fund-card {
  padding: 14px;
}

.fund-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.fund-name {
  margin: 0;
  font-size: 17px;
  line-height: 1.35;
}

.fund-code {
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}

.status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 700;
  background: #eaf2ff;
  color: var(--blue);
}

.status.error {
  background: #fff1f0;
  color: var(--red);
}

.status.stale {
  background: #fff7e6;
  color: var(--amber);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.metric {
  min-width: 0;
}

.label {
  color: var(--muted);
  font-size: 12px;
}

.value {
  margin-top: 3px;
  font-size: 20px;
  font-weight: 760;
  overflow-wrap: anywhere;
}

.positive {
  color: var(--red);
}

.negative {
  color: var(--green);
}

.message {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.section-title {
  margin: 22px 0 10px;
  font-size: 18px;
}

.history-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
  padding: 12px;
  font-size: 14px;
}

.history-card .name {
  font-weight: 700;
}

.history-card .date,
.history-card .error {
  color: var(--muted);
}

.notice {
  margin-top: 18px;
  padding: 12px;
  font-size: 13px;
}

@media (min-width: 680px) {
  .fund-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 5: Create browser renderer**

Create `assets/app.js`:

```js
const app = document.querySelector('#app');

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function formatPct(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function valueClass(value) {
  if (!Number.isFinite(value) || value === 0) {
    return '';
  }
  return value > 0 ? 'positive' : 'negative';
}

function statusText(status) {
  if (status === 'ok') {
    return '已估算';
  }
  if (status === 'error') {
    return '异常';
  }
  return '暂无估值';
}

function fundCard(fund) {
  return `
    <article class="fund-card">
      <div class="fund-head">
        <div>
          <h2 class="fund-name">${fund.name}</h2>
          <div class="fund-code">${fund.code}</div>
        </div>
        <span class="status ${fund.status}">${statusText(fund.status)}</span>
      </div>
      <div class="metric-grid">
        <div class="metric">
          <div class="label">预测收盘净值</div>
          <div class="value">${formatNumber(fund.predictedNav)}</div>
        </div>
        <div class="metric">
          <div class="label">预计涨跌</div>
          <div class="value ${valueClass(fund.predictedChangePct)}">${formatPct(fund.predictedChangePct)}</div>
        </div>
        <div class="metric">
          <div class="label">盘中估值</div>
          <div class="value">${formatNumber(fund.estimatedNav)}</div>
        </div>
        <div class="metric">
          <div class="label">最新官方净值</div>
          <div class="value">${formatNumber(fund.nav)}</div>
        </div>
      </div>
      <p class="message">${fund.message || '数据已更新。'} 更新时间：${fund.quoteTime || '--'}</p>
    </article>
  `;
}

function historyCard(record) {
  const error = Number.isFinite(record.error) ? record.error : null;
  return `
    <article class="history-card">
      <div class="name">${record.name}</div>
      <div class="date">${record.date}</div>
      <div>预测 ${formatNumber(record.predictedNav)}</div>
      <div class="error">误差 ${error === null ? '--' : formatNumber(error)}</div>
    </article>
  `;
}

function render(latest, history) {
  const recentHistory = [...(history.records || [])]
    .filter((record) => record.status === 'ok')
    .slice(-12)
    .reverse();

  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">14:30 估算</p>
      <h1>基金收盘估算</h1>
      <p class="summary">${latest.summary || '暂无摘要'} ${latest.generatedAt ? `生成时间：${new Date(latest.generatedAt).toLocaleString('zh-CN')}` : ''}</p>
    </section>
    <section class="fund-list">
      ${(latest.funds || []).map(fundCard).join('') || '<div class="notice">还没有基金数据。</div>'}
    </section>
    <h2 class="section-title">最近记录</h2>
    <section class="history-list">
      ${recentHistory.map(historyCard).join('') || '<div class="notice">暂无历史预测。</div>'}
    </section>
    <section class="notice disclaimer">
      本页面只根据公开估值数据做收盘净值估算，不构成投资建议。实际净值以基金公司公布为准。
    </section>
  `;
}

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return response.json();
}

try {
  const [latest, history] = await Promise.all([
    loadJson('data/latest.json'),
    loadJson('data/history.json'),
  ]);
  render(latest, history);
} catch (error) {
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">加载失败</p>
      <h1>基金收盘估算</h1>
      <p class="summary">${error.message}</p>
    </section>
  `;
}
```

- [ ] **Step 6: Run static smoke test to verify it passes**

Run: `node --test tests/static-smoke.test.mjs`

Expected: PASS.

- [ ] **Step 7: Run full tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: Commit static dashboard**

```bash
git add index.html assets/app.css assets/app.js tests/static-smoke.test.mjs
git commit -m "feat: add mobile fund dashboard"
```

---

## Task 5: GitHub Actions And Pages Deployment

**Files:**
- Create: `.github/workflows/update-fund-data.yml`
- Create: `.github/workflows/deploy-pages.yml`

- [ ] **Step 1: Create scheduled data update workflow**

Create `.github/workflows/update-fund-data.yml`:

```yaml
name: Update fund data

on:
  schedule:
    - cron: "30 6 * * 1-5"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run tests
        run: npm test

      - name: Update fund data
        run: npm run update

      - name: Commit updated data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/latest.json data/history.json
          git diff --cached --quiet || git commit -m "chore: update fund predictions"
          git push
```

- [ ] **Step 2: Create GitHub Pages deployment workflow**

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy Pages

on:
  push:
    branches:
      - master
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload static site
        uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Run full local tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 4: Commit workflows**

```bash
git add .github/workflows/update-fund-data.yml .github/workflows/deploy-pages.yml
git commit -m "ci: add scheduled fund updates and pages deploy"
```

---

## Task 6: Local Verification And Handoff

**Files:**
- Modify: data files only if `npm run update` succeeds.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Run one live update**

Run: `npm run update`

Expected: exit 0. If the public endpoint is reachable, `data/latest.json` contains four fund entries. If one quote fails, `data/latest.json` contains an `error` status for that fund and valid entries for the others.

- [ ] **Step 3: Serve the static page locally**

Run: `python3 -m http.server 8000`

Expected: server starts at `http://0.0.0.0:8000/`.

- [ ] **Step 4: Check mobile viewport in browser**

Open `http://127.0.0.1:8000/` with a mobile viewport around `390x844`.

Expected:
- Four fund cards fit the viewport width without horizontal scroll.
- Text does not overlap.
- Latest summary and disclaimer are visible.
- Recent records section renders even when history is empty.

- [ ] **Step 5: Stop local server**

Stop the `python3 -m http.server 8000` process with Ctrl-C or `kill`.

- [ ] **Step 6: Commit live data if changed and useful**

If `npm run update` produced useful live data:

```bash
git add data/latest.json data/history.json
git commit -m "chore: seed latest fund data"
```

If live data did not change or only contains endpoint errors, skip this commit.

- [ ] **Step 7: Deployment handoff**

Tell the user:

- The local verification commands that passed.
- Whether live data update succeeded.
- The GitHub Pages setup requirement: repository Settings -> Pages -> Source = GitHub Actions.
- After pushing to GitHub, the Pages workflow will publish the mobile URL.

---

## Self-Review

- Spec coverage: The plan covers the public mobile page, scheduled 14:30 Beijing update, JSON latest/history storage, transparent prediction model, error states, tests, and GitHub Pages deployment.
- Completion scan: No unfinished instructions remain; every implementation task names exact files and commands.
- Type consistency: Quote, prediction, latest, and history fields are consistent across parser, predictor, storage, updater, and browser renderer.
