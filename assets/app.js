import {
  buildRefreshProgress,
  createJsonpQuoteFetcher,
  mergeCatalogMetadata,
  mergeNewerOfficialNav,
  refreshFundsInBatches,
  shouldPublishLiveRanking,
  sortFundsForView,
} from './live-quotes.js';

const app = document.querySelector('#app');
const disclaimerText = '估算结果仅用于个人跟踪，不构成投资建议。实际净值以基金公司披露为准。';
const refreshConcurrency = 18;
const refreshIntervalMs = 60_000;

const state = {
  latest: { funds: [] },
  history: { records: [] },
  catalog: { funds: [] },
  funds: [],
  query: '',
  filter: 'all',
  sortKey: 'predictedChangePct',
  direction: 'desc',
  refreshProgress: null,
  refreshBusy: false,
  lastFullRefreshAt: '',
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

function statusText(status) {
  return {
    ok: '可用',
    stale: '暂无估值',
    error: '更新失败',
  }[status] ?? '未知';
}

function statusClass(status) {
  return ['status', status === 'error' ? 'error' : '', status === 'stale' ? 'stale' : '']
    .filter(Boolean)
    .join(' ');
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
  const changeValue = fund.predictedChangePct;
  const { estimatedChangePct } = fund;
  const message = fund.message
    ? `<p class="message">${escapeHtml(fund.message)}</p>`
    : '';
  const holdingBadge = fund.holding ? '<span class="mini-badge">持有</span>' : '';
  const groupBadge = fund.group ? `<span class="mini-badge muted">${escapeHtml(fund.group)}</span>` : '';

  return `
    <article class="fund-card">
      <div class="fund-head">
        <div>
          <h2 class="fund-name">${escapeHtml(fund.name)}</h2>
          <div class="fund-code">${escapeHtml(fund.code)} ${holdingBadge}${groupBadge}</div>
        </div>
        <span class="${statusClass(fund.status)}">${statusText(fund.status)}</span>
      </div>
      <div class="metric-grid">
        <div class="metric">
          <div class="label">预测净值</div>
          <div class="value">${formatNumber(fund.predictedNav)}</div>
        </div>
        <div class="metric">
          <div class="label">预测涨跌</div>
          <div class="value ${valueClass(changeValue)}">${formatPct(changeValue)}</div>
        </div>
        <div class="metric">
          <div class="label">估值涨跌</div>
          <div class="value ${valueClass(estimatedChangePct)}">${formatPct(estimatedChangePct)}</div>
        </div>
        <div class="metric">
          <div class="label">盘中估值</div>
          <div class="value">${formatNumber(fund.estimatedNav)}</div>
        </div>
        <div class="metric">
          <div class="label">确认净值</div>
          <div class="value">${formatNumber(fund.nav)}</div>
        </div>
      </div>
      <p class="message">估值时间：${displayDateTime(fund.quoteTime)} · 确认日期：${displayDateTime(fund.navDate)}</p>
      ${message}
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
  return `<p class="meta refresh-status" id="refreshStatus">${escapeHtml(state.refreshProgress.text)}，${note}</p>`;
}

function renderControls() {
  return `
    <section class="controls">
      <input id="fundSearch" class="search-input" type="search" placeholder="搜索代码或基金名" value="${escapeHtml(state.query)}">
      <div class="control-grid">
        <label>
          <span>筛选</span>
          <select id="fundFilter">
            <option value="all"${state.filter === 'all' ? ' selected' : ''}>全部</option>
            <option value="holding"${state.filter === 'holding' ? ' selected' : ''}>持有</option>
            <option value="watching"${state.filter === 'watching' ? ' selected' : ''}>观察</option>
            <option value="positive"${state.filter === 'positive' ? ' selected' : ''}>上涨</option>
            <option value="negative"${state.filter === 'negative' ? ' selected' : ''}>下跌</option>
            <option value="error"${state.filter === 'error' ? ' selected' : ''}>失败</option>
          </select>
        </label>
        <label>
          <span>排序</span>
          <select id="sortKey">
            <option value="predictedChangePct"${state.sortKey === 'predictedChangePct' ? ' selected' : ''}>预测涨跌</option>
            <option value="estimatedChangePct"${state.sortKey === 'estimatedChangePct' ? ' selected' : ''}>估值涨跌</option>
            <option value="nav"${state.sortKey === 'nav' ? ' selected' : ''}>确认净值</option>
            <option value="quoteTime"${state.sortKey === 'quoteTime' ? ' selected' : ''}>估值时间</option>
            <option value="code"${state.sortKey === 'code' ? ' selected' : ''}>基金代码</option>
            <option value="custom"${state.sortKey === 'custom' ? ' selected' : ''}>自定义顺序</option>
          </select>
        </label>
        <button id="sortDirection" class="secondary-button" type="button">${state.direction === 'desc' ? '降序' : '升序'}</button>
        <button id="refreshNow" class="primary-button" type="button"${state.refreshBusy ? ' disabled' : ''}>刷新</button>
      </div>
    </section>
  `;
}

function render() {
  const records = Array.isArray(state.history.records)
    ? [...state.history.records].reverse().slice(0, 8)
    : [];
  const funds = sortFundsForView(state.funds, {
    sortKey: state.sortKey,
    direction: state.direction,
    query: state.query,
    filter: state.filter,
  });
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
      ${funds.length ? funds.map(fundCard).join('') : '<div class="notice">暂无基金数据。</div>'}
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
    status.textContent = `${state.refreshProgress.text}，${note}`;
  }
}

function bindControls() {
  app.querySelector('#fundSearch')?.addEventListener('input', (event) => {
    state.query = event.currentTarget.value;
    render();
  });
  app.querySelector('#fundFilter')?.addEventListener('change', (event) => {
    state.filter = event.currentTarget.value;
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

async function startFullRefresh() {
  if (state.refreshBusy) {
    return;
  }
  const funds = Array.isArray(state.catalog.funds) ? state.catalog.funds : [];
  if (!funds.length) {
    return;
  }
  state.refreshBusy = true;
  state.refreshProgress = buildRefreshProgress({ completed: 0, total: funds.length, failed: 0 });
  render();

  try {
    const fetchQuote = createJsonpQuoteFetcher();
    const tradingDate = currentChinaDate();
    const result = await refreshFundsInBatches({
      funds,
      fetchQuote,
      historyRecords: Array.isArray(state.history.records) ? state.history.records : [],
      tradingDate,
      concurrency: refreshConcurrency,
      onProgress: (progress) => {
        state.refreshProgress = progress;
        updateRefreshStatus();
      },
    });

    state.refreshProgress = result.progress;
    if (shouldPublishLiveRanking(result.progress)) {
      state.funds = mergeCatalogMetadata(mergeNewerOfficialNav(result.funds, state.funds), funds);
      state.latest = {
        ...state.latest,
        generatedAt: new Date().toISOString(),
        tradingDate,
        summary: '已完成网页端全量实时刷新，按最新结果排序。',
        funds: state.funds,
      };
      state.lastFullRefreshAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
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
