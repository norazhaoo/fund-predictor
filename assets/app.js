import {
  applyBenchmarkQuotes,
  buildRefreshProgress,
  carryForwardBenchmarkQuotes,
  carryForwardQuoteSnapshot,
  createBenchmarkScriptFetcher,
  createJsonpQuoteFetcher,
  createOfficialNavScriptFetcher,
  mergeCatalogMetadata,
  mergeNewerOfficialNav,
  mergeRetriedFunds,
  rateLimitedErrorFunds,
  refreshFundsInBatches,
  shouldPublishLiveRanking,
  sortFundsForView,
} from './live-quotes.js';

const app = document.querySelector('#app');
const disclaimerText = '估算结果仅用于个人跟踪，不构成投资建议。实际净值以基金公司披露为准。';
const refreshConcurrency = 4;
const refreshRequestSpacingMs = 250;
const refreshInitialQuoteRetries = 0;
const refreshRetryBackoffMs = 3000;
const backgroundRetryDelayMs = 15_000;
const backgroundRetryMaxRounds = 6;
const backgroundRetryConcurrency = 2;
const backgroundRetryRequestSpacingMs = 800;
const refreshIntervalMs = 10 * 60_000;
const estimateDifferenceThresholdPct = 0.1;

const state = {
  latest: { funds: [] },
  history: { records: [] },
  catalog: { funds: [] },
  funds: [],
  query: '',
  filter: 'all',
  groupFilter: 'all',
  sortKey: 'predictedChangePct',
  direction: 'desc',
  refreshProgress: null,
  refreshBusy: false,
  lastFullRefreshAt: '',
  backgroundRetryText: '',
  backgroundRetryTimer: null,
  backgroundRetryToken: 0,
  expandedCodes: new Set(),
};

const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '暂无';
}

function formatPct(value) {
  if (!Number.isFinite(value)) {
    return '暂无';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function valueClass(value) {
  if (!Number.isFinite(value) || value === 0) {
    return '';
  }
  return value > 0 ? 'positive' : 'negative';
}

function estimateNavValue(fund) {
  return Number.isFinite(fund.predictedNav) ? fund.predictedNav : fund.estimatedNav;
}

function estimateChangeValue(fund) {
  return Number.isFinite(fund.predictedChangePct) ? fund.predictedChangePct : fund.estimatedChangePct;
}

function estimateDifferencePct(fund) {
  if (!Number.isFinite(fund.predictedChangePct) || !Number.isFinite(fund.estimatedChangePct)) {
    return null;
  }
  return Number((fund.predictedChangePct - fund.estimatedChangePct).toFixed(2));
}

function shouldShowRawEstimate(fund) {
  const difference = estimateDifferencePct(fund);
  return difference !== null && Math.abs(difference) >= estimateDifferenceThresholdPct;
}

function statusText(fund) {
  if (fund.status === 'stale' && Number.isFinite(estimateNavValue(fund))) {
    return '上一交易日';
  }
  return {
    ok: '可用',
    proxy: '可用',
    stale: '暂无估值',
    error: '更新失败',
  }[fund.status] ?? '未知';
}

function statusClass(status) {
  return [
    'status',
    status === 'error' ? 'error' : '',
    status === 'stale' ? 'stale' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function quoteMetaLabel(fund) {
  if (fund.status === 'stale' && Number.isFinite(estimateNavValue(fund))) {
    return '上一交易日';
  }
  return '估算';
}

function displayDateTime(value) {
  return value ? escapeHtml(value) : '暂无';
}

function currentChinaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function disclaimerNotice() {
  return `<p class="notice disclaimer">${disclaimerText}</p>`;
}

function fundCard(fund) {
  const code = String(fund.code).padStart(6, '0');
  const expanded = state.expandedCodes.has(code);
  const estimateNav = estimateNavValue(fund);
  const estimateChange = estimateChangeValue(fund);
  const rawEstimateDifference = estimateDifferencePct(fund);
  const rawEstimateVisible = shouldShowRawEstimate(fund);
  const benchmark = fund.benchmark;
  const message = fund.message
    ? `<p class="message">${escapeHtml(fund.message)}</p>`
    : '';
  const benchmarkLine = benchmark?.name
    ? `<p class="message">参考指数：${escapeHtml(benchmark.name)} ${formatPct(benchmark.changePct)} · 指数修正：${formatNumber(fund.benchmarkAdjustment, 4)}</p>`
    : '';
  const rawEstimateMetrics = rawEstimateVisible
    ? `
            <div class="metric">
              <div class="label">盘中估值</div>
              <div class="value">${formatNumber(fund.estimatedNav)}</div>
            </div>
            <div class="metric">
              <div class="label">原始涨跌</div>
              <div class="value ${valueClass(fund.estimatedChangePct)}">${formatPct(fund.estimatedChangePct)}</div>
            </div>
            <div class="metric">
              <div class="label">修正幅度</div>
              <div class="value ${valueClass(rawEstimateDifference)}">${formatPct(rawEstimateDifference)}</div>
            </div>
      `
    : '';
  const estimateNote = !rawEstimateVisible && Number.isFinite(fund.estimatedNav) && Number.isFinite(fund.predictedNav)
    ? '<p class="message">基于盘中估值，修正幅度很小。</p>'
    : '';
  const holdingBadge = fund.holding ? '<span class="mini-badge">持有</span>' : '';
  const groupBadge = fund.group ? `<span class="mini-badge muted">${escapeHtml(fund.group)}</span>` : '';

  return `
    <article class="fund-card${expanded ? ' is-expanded' : ''}">
      <button
        class="fund-summary-button"
        type="button"
        data-code="${escapeHtml(code)}"
        aria-expanded="${expanded}"
        aria-controls="fund-detail-${escapeHtml(code)}"
      >
        <span class="fund-summary-head">
          <span class="fund-title-block">
            <span class="fund-name">${escapeHtml(fund.name)}</span>
            <span class="fund-code">${escapeHtml(code)} ${holdingBadge}${groupBadge}</span>
          </span>
          <span class="${statusClass(fund.status)}">${statusText(fund)}</span>
        </span>
        <span class="compact-grid">
          <span class="compact-metric">
            <span class="label">估算涨跌</span>
            <span class="compact-value primary ${valueClass(estimateChange)}">${formatPct(estimateChange)}</span>
          </span>
          <span class="compact-metric">
            <span class="label">估算净值</span>
            <span class="compact-value">${formatNumber(estimateNav)}</span>
          </span>
          <span class="compact-metric">
            <span class="label">确认净值</span>
            <span class="compact-value">${formatNumber(fund.nav)}</span>
          </span>
          <span class="compact-metric">
            <span class="label">时间</span>
            <span class="compact-value compact-time">${displayDateTime(fund.quoteTime)}</span>
          </span>
        </span>
        <span class="compact-meta">${quoteMetaLabel(fund)} · ${expanded ? '收起详情' : '展开详情'}</span>
      </button>
      ${expanded ? `
        <div id="fund-detail-${escapeHtml(code)}" class="fund-detail">
          <div class="metric-grid">
            <div class="metric">
              <div class="label">估算净值</div>
              <div class="value">${formatNumber(estimateNav)}</div>
            </div>
            <div class="metric">
              <div class="label">估算涨跌</div>
              <div class="value ${valueClass(estimateChange)}">${formatPct(estimateChange)}</div>
            </div>
            <div class="metric">
              <div class="label">确认净值</div>
              <div class="value">${formatNumber(fund.nav)}</div>
            </div>
            ${rawEstimateMetrics}
          </div>
          <p class="message">${quoteMetaLabel(fund)}时间：${displayDateTime(fund.quoteTime)} · 确认日期：${displayDateTime(fund.navDate)}</p>
          ${estimateNote}
          ${benchmarkLine}
          ${message}
        </div>
      ` : ''}
    </article>
  `;
}

function historyCard(record) {
  const errorClass = valueClass(record.error);
  const actual = Number.isFinite(record.actualNav)
    ? `实际 ${formatNumber(record.actualNav)}`
    : '实际待回填';
  const error = Number.isFinite(record.error)
    ? `误差 <span class="${errorClass}">${formatNumber(record.error)}</span>`
    : '误差待回填';

  return `
    <article class="history-card">
      <div class="name">${escapeHtml(record.name)}</div>
      <div class="date">${escapeHtml(record.date)}</div>
      <div>预测 ${formatNumber(record.predictedNav)}</div>
      <div>${actual}</div>
      <div class="error">${error}</div>
      <div>${formatPct(record.predictedChangePct)}</div>
    </article>
  `;
}

function placeholderFund(fund) {
  return {
    code: String(fund.code).padStart(6, '0'),
    name: fund.fallbackName || fund.name || fund.code,
    navDate: null,
    nav: null,
    estimatedNav: null,
    estimatedChangePct: null,
    quoteTime: null,
    predictedNav: null,
    predictedChangePct: null,
    status: 'stale',
    message: '等待首次全量刷新。',
    holding: Boolean(fund.holding),
    group: fund.group ?? '',
    order: Number.isFinite(fund.order) ? fund.order : 0,
  };
}

function fundsFromLatest(latest, catalog) {
  const latestFunds = Array.isArray(latest.funds) ? latest.funds : [];
  const catalogFunds = Array.isArray(catalog.funds) ? catalog.funds : [];
  const latestByCode = new Map(latestFunds.map((fund) => [String(fund.code).padStart(6, '0'), fund]));
  const merged = catalogFunds.length
    ? catalogFunds.map((fund) => latestByCode.get(String(fund.code).padStart(6, '0')) ?? placeholderFund(fund))
    : latestFunds;
  return mergeCatalogMetadata(merged, catalogFunds);
}

function refreshStatusHtml() {
  if (!state.refreshProgress) {
    return '<p class="meta refresh-status" id="refreshStatus">显示上一次完整排名，打开页面后会自动全量刷新。</p>';
  }
  const note = shouldPublishLiveRanking(state.refreshProgress)
    ? `排名时间：${escapeHtml(state.lastFullRefreshAt || '刚刚')}`
    : '当前排名仍为上次完整结果';
  const retryNote = state.backgroundRetryText ? `，${escapeHtml(state.backgroundRetryText)}` : '';
  return `<p class="meta refresh-status" id="refreshStatus">${escapeHtml(state.refreshProgress.text)}，${note}${retryNote}</p>`;
}

function groupOptions(funds) {
  const seen = new Set();
  const groups = [];
  for (const fund of funds) {
    const group = String(fund.group ?? '').trim();
    if (!group || seen.has(group)) {
      continue;
    }
    seen.add(group);
    groups.push(group);
  }
  return groups;
}

function renderControls() {
  const groupOptionHtml = groupOptions(state.funds)
    .map((group) => `<option value="${escapeHtml(group)}"${state.groupFilter === group ? ' selected' : ''}>${escapeHtml(group)}</option>`)
    .join('');

  return `
    <section class="controls">
      <input id="fundSearch" class="search-input" type="search" placeholder="搜索代码或基金名" value="${escapeHtml(state.query)}">
      <div class="control-grid">
        <label>
          <span>筛选</span>
          <select id="fundFilter">
            <option value="all"${state.filter === 'all' ? ' selected' : ''}>全部</option>
            <option value="positive"${state.filter === 'positive' ? ' selected' : ''}>上涨</option>
            <option value="negative"${state.filter === 'negative' ? ' selected' : ''}>下跌</option>
            <option value="success"${state.filter === 'success' ? ' selected' : ''}>成功</option>
            <option value="nonProxy"${state.filter === 'nonProxy' ? ' selected' : ''}>非替代估算</option>
          </select>
        </label>
        <label>
          <span>板块</span>
          <select id="fundGroupFilter">
            <option value="all"${state.groupFilter === 'all' ? ' selected' : ''}>全部板块</option>
            ${groupOptionHtml}
          </select>
        </label>
        <label>
          <span>排序</span>
          <select id="sortKey">
            <option value="predictedChangePct"${state.sortKey === 'predictedChangePct' ? ' selected' : ''}>估算涨跌</option>
            <option value="nav"${state.sortKey === 'nav' ? ' selected' : ''}>确认净值</option>
          </select>
        </label>
        <button id="sortDirection" class="secondary-button" type="button">${state.direction === 'desc' ? '降序' : '升序'}</button>
        <button id="refreshNow" class="primary-button" type="button"${state.refreshBusy ? ' disabled' : ''}>刷新</button>
      </div>
    </section>
  `;
}

function visibleFunds() {
  return sortFundsForView(state.funds, {
    sortKey: state.sortKey,
    direction: state.direction,
    query: state.query,
    filter: state.filter,
    groupFilter: state.groupFilter,
  });
}

function fundListHtml() {
  const funds = visibleFunds();
  return funds.length ? funds.map(fundCard).join('') : '<div class="notice">暂无基金数据。</div>';
}

function renderFundList() {
  const list = app.querySelector('.fund-list');
  if (!list) {
    return;
  }
  list.innerHTML = fundListHtml();
  bindFundCards();
}

function render() {
  const records = Array.isArray(state.history.records)
    ? [...state.history.records].reverse().slice(0, 8)
    : [];
  const generatedAt = state.latest.generatedAt
    ? new Date(state.latest.generatedAt).toLocaleString('zh-CN', { hour12: false })
    : '暂无';

  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${escapeHtml(state.latest.tradingDate ?? '14:30 估算')}</p>
      <h1>基金收盘估算</h1>
      <p class="summary">${escapeHtml(state.latest.summary ?? '暂无最新摘要。')}</p>
      <p class="meta">更新时间：${escapeHtml(generatedAt)}</p>
      ${refreshStatusHtml()}
    </section>
    ${renderControls()}
    <section class="fund-list">
      ${fundListHtml()}
    </section>
    <h2 class="section-title">历史记录</h2>
    <section class="history-list">
      ${records.length ? records.map(historyCard).join('') : '<div class="notice">暂无历史记录。</div>'}
    </section>
    ${disclaimerNotice()}
  `;
  bindControls();
}

function updateRefreshStatus() {
  const status = app.querySelector('#refreshStatus');
  if (status) {
    const note = shouldPublishLiveRanking(state.refreshProgress)
      ? `排名时间：${state.lastFullRefreshAt || '刚刚'}`
      : '当前排名仍为上次完整结果';
    const retryNote = state.backgroundRetryText ? `，${state.backgroundRetryText}` : '';
    status.textContent = `${state.refreshProgress.text}，${note}${retryNote}`;
  }
}

function setBackgroundRetryText(text) {
  state.backgroundRetryText = text;
  updateRefreshStatus();
}

function clearBackgroundRetry() {
  state.backgroundRetryToken += 1;
  if (state.backgroundRetryTimer) {
    window.clearTimeout(state.backgroundRetryTimer);
    state.backgroundRetryTimer = null;
  }
  state.backgroundRetryText = '';
}

function toggleFundCard(code) {
  if (state.expandedCodes.has(code)) {
    state.expandedCodes.delete(code);
  } else {
    state.expandedCodes.add(code);
  }
  render();
}

function bindControls() {
  app.querySelector('#fundSearch')?.addEventListener('input', (event) => {
    state.query = event.currentTarget.value;
    renderFundList();
  });
  app.querySelector('#fundFilter')?.addEventListener('change', (event) => {
    state.filter = event.currentTarget.value;
    render();
  });
  app.querySelector('#fundGroupFilter')?.addEventListener('change', (event) => {
    state.groupFilter = event.currentTarget.value;
    render();
  });
  app.querySelector('#sortKey')?.addEventListener('change', (event) => {
    state.sortKey = event.currentTarget.value;
    render();
  });
  app.querySelector('#sortDirection')?.addEventListener('click', () => {
    state.direction = state.direction === 'desc' ? 'asc' : 'desc';
    render();
  });
  app.querySelector('#refreshNow')?.addEventListener('click', () => {
    startFullRefresh();
  });
  bindFundCards();
}

function bindFundCards() {
  app.querySelectorAll('.fund-summary-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      toggleFundCard(event.currentTarget.dataset.code);
    });
  });
}

async function readJsonResponse(response) {
  if (!response.ok) {
    throw new Error(`数据请求失败：${response.status}`);
  }
  return response.json();
}

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  return readJsonResponse(response);
}

async function boot() {
  try {
    const [latest, history, catalog] = await Promise.all([
      loadJson('data/latest.json'),
      loadJson('data/history.json'),
      loadJson('data/funds.json'),
    ]);
    state.latest = latest;
    state.history = history;
    state.catalog = catalog;
    state.funds = fundsFromLatest(latest, catalog);
    render();
    startFullRefresh();
    window.setInterval(startFullRefresh, refreshIntervalMs);
  } catch (error) {
    app.innerHTML = `
      <section class="hero">
        <p class="eyebrow">14:30 估算</p>
        <h1>基金收盘估算</h1>
        <p class="summary">数据加载失败，请稍后刷新。</p>
      </section>
      <div class="notice">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
      ${disclaimerNotice()}
    `;
  }
}

function publishFullRefresh(funds, catalogFunds, tradingDate, summary) {
  const refreshedAt = new Date();
  state.lastFullRefreshAt = refreshedAt.toLocaleTimeString('zh-CN', { hour12: false });
  state.funds = mergeCatalogMetadata(mergeNewerOfficialNav(funds, state.funds), catalogFunds);
  state.latest = {
    ...state.latest,
    generatedAt: refreshedAt.toISOString(),
    tradingDate,
    summary,
    funds: state.funds,
  };
}

function publishRetriedFunds(funds, tradingDate) {
  const refreshedAt = new Date();
  state.lastFullRefreshAt = refreshedAt.toLocaleTimeString('zh-CN', { hour12: false });
  state.funds = mergeCatalogMetadata(
    mergeRetriedFunds(state.funds, funds),
    Array.isArray(state.catalog.funds) ? state.catalog.funds : [],
  );
  state.latest = {
    ...state.latest,
    generatedAt: refreshedAt.toISOString(),
    tradingDate,
    summary: `后台重试已补回 ${funds.length} 只基金。`,
    funds: state.funds,
  };
  state.refreshProgress = buildRefreshProgress({
    completed: state.funds.length,
    total: state.funds.length,
    failed: state.funds.filter((fund) => fund.status === 'error').length,
  });
}

function scheduleBackgroundRetry(sourceFunds, { tradingDate, round = 1, delayMs = backgroundRetryDelayMs } = {}) {
  const retryFunds = rateLimitedErrorFunds(sourceFunds);
  if (!retryFunds.length || round > backgroundRetryMaxRounds) {
    setBackgroundRetryText('');
    return;
  }

  if (state.backgroundRetryTimer) {
    window.clearTimeout(state.backgroundRetryTimer);
  }

  const token = state.backgroundRetryToken;
  setBackgroundRetryText(`后台重试排队：${retryFunds.length} 只 514，稍后自动补`);
  state.backgroundRetryTimer = window.setTimeout(() => {
    runBackgroundRetry(retryFunds, { tradingDate, round, token });
  }, delayMs);
}

async function runBackgroundRetry(retryFunds, { tradingDate, round, token }) {
  if (token !== state.backgroundRetryToken) {
    return;
  }
  state.backgroundRetryTimer = null;
  const total = retryFunds.length;
  let retryCompleted = 0;
  setBackgroundRetryText(`后台重试中：0/${total}`);

  try {
    const result = await refreshFundsInBatches({
      funds: retryFunds,
      fetchQuote: createJsonpQuoteFetcher(),
      fetchProxyBase: createOfficialNavScriptFetcher(),
      historyRecords: Array.isArray(state.history.records) ? state.history.records : [],
      tradingDate,
      concurrency: backgroundRetryConcurrency,
      requestSpacingMs: backgroundRetryRequestSpacingMs,
      quoteMaxRetries: 0,
      quoteRetryBackoffMs: refreshRetryBackoffMs,
      onProgress: (progress) => {
        retryCompleted = progress.completed;
        setBackgroundRetryText(`后台重试中：${retryCompleted}/${total}`);
      },
    });
    if (token !== state.backgroundRetryToken) {
      return;
    }

    const recoveredFunds = result.funds.filter((fund) => fund.status !== 'error');
    const remainingRateLimited = rateLimitedErrorFunds(result.funds);
    if (recoveredFunds.length) {
      publishRetriedFunds(recoveredFunds, tradingDate);
    }

    if (remainingRateLimited.length && round < backgroundRetryMaxRounds) {
      setBackgroundRetryText(`后台重试第 ${round} 轮完成，仍有 ${remainingRateLimited.length} 只 514`);
      render();
      scheduleBackgroundRetry(remainingRateLimited, {
        tradingDate,
        round: round + 1,
        delayMs: backgroundRetryDelayMs,
      });
      return;
    }

    setBackgroundRetryText(
      remainingRateLimited.length
        ? `后台重试暂停：仍有 ${remainingRateLimited.length} 只 514`
        : '',
    );
  } catch (error) {
    if (token === state.backgroundRetryToken) {
      setBackgroundRetryText(`后台重试暂停：${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    if (token === state.backgroundRetryToken) {
      render();
    }
  }
}

async function startFullRefresh() {
  if (state.refreshBusy) {
    return;
  }
  clearBackgroundRetry();
  let funds = carryForwardQuoteSnapshot(
    carryForwardBenchmarkQuotes(
      Array.isArray(state.catalog.funds) ? state.catalog.funds : [],
      state.funds,
    ),
    state.funds,
  );
  if (!funds.length) {
    return;
  }
  state.refreshBusy = true;
  state.refreshProgress = buildRefreshProgress({ completed: 0, total: funds.length, failed: 0 });
  render();

  try {
    try {
      const fetchBenchmarkQuotes = createBenchmarkScriptFetcher();
      const benchmarkQuotes = await fetchBenchmarkQuotes(funds.map((fund) => fund.benchmark).filter(Boolean));
      funds = applyBenchmarkQuotes(funds, benchmarkQuotes);
    } catch {
      // Keep the carried-forward benchmark quote if the reference source is unavailable.
    }

    const fetchQuote = createJsonpQuoteFetcher();
    const fetchProxyBase = createOfficialNavScriptFetcher();
    const tradingDate = currentChinaDate();
    const result = await refreshFundsInBatches({
      funds,
      fetchQuote,
      fetchProxyBase,
      historyRecords: Array.isArray(state.history.records) ? state.history.records : [],
      tradingDate,
      concurrency: refreshConcurrency,
      requestSpacingMs: refreshRequestSpacingMs,
      quoteMaxRetries: refreshInitialQuoteRetries,
      quoteRetryBackoffMs: refreshRetryBackoffMs,
      onProgress: (progress) => {
        state.refreshProgress = progress;
        updateRefreshStatus();
      },
    });

    state.refreshProgress = result.progress;
    if (shouldPublishLiveRanking(result.progress)) {
      publishFullRefresh(result.funds, funds, tradingDate, '已完成网页端全量实时刷新，按最新结果排序。');
      scheduleBackgroundRetry(state.funds, { tradingDate });
    } else {
      scheduleBackgroundRetry(result.funds, { tradingDate });
    }
  } catch (error) {
    state.refreshProgress = {
      completed: 0,
      total: funds.length,
      failed: funds.length,
      isComplete: false,
      text: `全量刷新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    state.refreshBusy = false;
    render();
  }
}

boot();
