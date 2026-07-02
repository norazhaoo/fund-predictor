import {
  mergeCatalogMetadata,
  sortFundsForView,
} from './live-quotes.js';
import { sortTradeRadarFunds } from './t-radar.js';

const app = document.querySelector('#app');
const disclaimerText = '估算结果仅用于个人跟踪，不构成投资建议。实际净值以基金公司披露为准。';
const estimateDifferenceThresholdPct = 0.1;

const state = {
  latest: { funds: [] },
  history: { records: [] },
  catalog: { funds: [] },
  funds: [],
  viewMode: 'estimate',
  query: '',
  filter: 'all',
  groupFilter: 'all',
  tradeActionFilter: 'all',
  sortKey: 'predictedChangePct',
  direction: 'desc',
  refreshBusy: false,
  lastLocalReloadAt: '',
  localRefreshError: '',
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

function isConfirmedFund(fund) {
  return fund.status === 'confirmed' && Number.isFinite(fund.officialChangePct);
}

function primaryNavValue(fund) {
  if (isConfirmedFund(fund) && Number.isFinite(fund.nav)) {
    return fund.nav;
  }
  return estimateNavValue(fund);
}

function primaryChangeValue(fund) {
  if (isConfirmedFund(fund)) {
    return fund.officialChangePct;
  }
  return estimateChangeValue(fund);
}

function estimateDifferencePct(fund) {
  const primaryChange = primaryChangeValue(fund);
  if (!Number.isFinite(primaryChange) || !Number.isFinite(fund.estimatedChangePct)) {
    return null;
  }
  return Number((primaryChange - fund.estimatedChangePct).toFixed(2));
}

function shouldShowRawEstimate(fund) {
  const difference = estimateDifferencePct(fund);
  return difference !== null && Math.abs(difference) >= estimateDifferenceThresholdPct;
}

function statusText(fund) {
  if (fund.status === 'confirmed') {
    return '已确认';
  }
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
    status === 'confirmed' ? 'confirmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function quoteMetaLabel(fund) {
  if (fund.status === 'confirmed') {
    return '确认';
  }
  if (fund.status === 'stale' && Number.isFinite(estimateNavValue(fund))) {
    return '上一交易日';
  }
  return '估算';
}

function displayDateTime(value) {
  return value ? escapeHtml(value) : '暂无';
}

function disclaimerNotice() {
  return `<p class="notice disclaimer">${disclaimerText}</p>`;
}

function fundCard(fund) {
  const code = String(fund.code).padStart(6, '0');
  const expanded = state.expandedCodes.has(code);
  const confirmed = isConfirmedFund(fund);
  const primaryNav = primaryNavValue(fund);
  const primaryChange = primaryChangeValue(fund);
  const rawEstimateDifference = estimateDifferencePct(fund);
  const rawEstimateVisible = shouldShowRawEstimate(fund);
  const primaryChangeLabel = confirmed ? '确认涨跌' : '估算涨跌';
  const primaryNavLabel = confirmed ? '确认净值' : '估算净值';
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
              <div class="label">${confirmed ? '估算偏差' : '修正幅度'}</div>
              <div class="value ${valueClass(rawEstimateDifference)}">${formatPct(rawEstimateDifference)}</div>
            </div>
      `
    : '';
  const estimateNote = !confirmed && !rawEstimateVisible && Number.isFinite(fund.estimatedNav) && Number.isFinite(fund.predictedNav)
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
            <span class="label">${primaryChangeLabel}</span>
            <span class="compact-value primary ${valueClass(primaryChange)}">${formatPct(primaryChange)}</span>
          </span>
          <span class="compact-metric">
            <span class="label">${primaryNavLabel}</span>
            <span class="compact-value">${formatNumber(primaryNav)}</span>
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
              <div class="label">${primaryNavLabel}</div>
              <div class="value">${formatNumber(primaryNav)}</div>
            </div>
            <div class="metric">
              <div class="label">${primaryChangeLabel}</div>
              <div class="value ${valueClass(primaryChange)}">${formatPct(primaryChange)}</div>
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

function tradeSignalClass(action) {
  return [
    'trade-signal-badge',
    action ? `trade-${action}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function listItems(items) {
  return items.length
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>暂无补充说明。</li>';
}

function tradeCard(fund) {
  const code = String(fund.code).padStart(6, '0');
  const signal = fund.tradeSignal;
  const holdingBadge = fund.holding ? '<span class="mini-badge">持有</span>' : '';
  const groupBadge = fund.group ? `<span class="mini-badge muted">${escapeHtml(fund.group)}</span>` : '';

  return `
    <article class="fund-card trade-card">
      <div class="trade-card-body">
        <div class="fund-summary-head">
          <span class="fund-title-block">
            <span class="fund-name">${escapeHtml(fund.name)}</span>
            <span class="fund-code">${escapeHtml(code)} ${holdingBadge}${groupBadge}</span>
          </span>
          <span class="${tradeSignalClass(signal.action)}">${escapeHtml(signal.label)}</span>
        </div>
        <div class="trade-grid">
          <div class="metric">
            <div class="label">T分数</div>
            <div class="trade-score">${signal.score}</div>
          </div>
          <div class="metric">
            <div class="label">信号</div>
            <div class="value">${escapeHtml(signal.label)}</div>
          </div>
          <div class="metric">
            <div class="label">估算涨跌</div>
            <div class="value ${valueClass(signal.changePct)}">${formatPct(signal.changePct)}</div>
          </div>
          <div class="metric">
            <div class="label">参考指数</div>
            <div class="value ${valueClass(signal.benchmarkChangePct)}">${formatPct(signal.benchmarkChangePct)}</div>
          </div>
        </div>
        <p class="compact-meta">目标持有：${escapeHtml(signal.targetHoldingDays)} · 置信度：${escapeHtml(signal.confidence)} · ${quoteMetaLabel(fund)}时间：${displayDateTime(fund.quoteTime)}</p>
        <ul class="trade-reason-list">
          ${listItems(signal.reasons)}
        </ul>
        ${signal.risks.length ? `
          <ul class="trade-reason-list trade-risk-list">
            ${listItems(signal.risks)}
          </ul>
        ` : ''}
      </div>
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
  const reloadText = state.lastLocalReloadAt
    ? `本页读取时间：${escapeHtml(state.lastLocalReloadAt)}。`
    : '';
  const errorText = state.localRefreshError
    ? ` 上次读取失败：${escapeHtml(state.localRefreshError)}`
    : '';
  return `<p class="meta refresh-status" id="refreshStatus">${reloadText}点击刷新读取最新本地结果。${errorText}</p>`;
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

function viewTabClass(mode) {
  return [
    'view-tab',
    state.viewMode === mode ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function renderViewTabs() {
  return `
    <div class="view-tabs" role="tablist" aria-label="视图">
      <button class="${viewTabClass('estimate')}" type="button" data-view-mode="estimate" aria-pressed="${state.viewMode === 'estimate'}">估算</button>
      <button class="${viewTabClass('trade')}" type="button" data-view-mode="trade" aria-pressed="${state.viewMode === 'trade'}">做T</button>
    </div>
  `;
}

function renderControls() {
  const groupOptionHtml = groupOptions(state.funds)
    .map((group) => `<option value="${escapeHtml(group)}"${state.groupFilter === group ? ' selected' : ''}>${escapeHtml(group)}</option>`)
    .join('');

  const tradeControls = `
    <div class="control-grid trade-control-grid">
      <label>
        <span>信号</span>
        <select id="tradeActionFilter">
          <option value="all"${state.tradeActionFilter === 'all' ? ' selected' : ''}>全部信号</option>
          <option value="actionable"${state.tradeActionFilter === 'actionable' ? ' selected' : ''}>可操作</option>
          <option value="lowBuy"${state.tradeActionFilter === 'lowBuy' ? ' selected' : ''}>低吸观察</option>
          <option value="hold"${state.tradeActionFilter === 'hold' ? ' selected' : ''}>趋势持有</option>
          <option value="caution"${state.tradeActionFilter === 'caution' ? ' selected' : ''}>冲高谨慎</option>
          <option value="avoid"${state.tradeActionFilter === 'avoid' ? ' selected' : ''}>回避</option>
        </select>
      </label>
      <label>
        <span>板块</span>
        <select id="fundGroupFilter">
          <option value="all"${state.groupFilter === 'all' ? ' selected' : ''}>全部板块</option>
          ${groupOptionHtml}
        </select>
      </label>
      <button id="refreshNow" class="primary-button" type="button"${state.refreshBusy ? ' disabled' : ''}>刷新</button>
    </div>
  `;

  const estimateControls = `
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
  `;

  return `
    <section class="controls">
      ${renderViewTabs()}
      <input id="fundSearch" class="search-input" type="search" placeholder="搜索代码或基金名" value="${escapeHtml(state.query)}">
      ${state.viewMode === 'trade' ? tradeControls : estimateControls}
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

function visibleTradeFunds() {
  return sortTradeRadarFunds(state.funds, {
    actionFilter: state.tradeActionFilter,
    groupFilter: state.groupFilter,
    query: state.query,
  });
}

function fundListHtml() {
  if (state.viewMode === 'trade') {
    const funds = visibleTradeFunds();
    return funds.length ? funds.map(tradeCard).join('') : '<div class="notice">暂无做T雷达数据。</div>';
  }
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

function toggleFundCard(code) {
  if (state.expandedCodes.has(code)) {
    state.expandedCodes.delete(code);
  } else {
    state.expandedCodes.add(code);
  }
  render();
}

function bindControls() {
  app.querySelectorAll('[data-view-mode]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const nextMode = event.currentTarget.dataset.viewMode;
      if (nextMode && nextMode !== state.viewMode) {
        state.viewMode = nextMode;
        state.expandedCodes.clear();
        render();
      }
    });
  });
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
  app.querySelector('#tradeActionFilter')?.addEventListener('change', (event) => {
    state.tradeActionFilter = event.currentTarget.value;
    renderFundList();
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
    reloadLocalData();
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

async function readLocalData() {
  const [latest, history, catalog] = await Promise.all([
    loadJson('data/latest.json'),
    loadJson('data/history.json'),
    loadJson('data/funds.json'),
  ]);
  return { latest, history, catalog };
}

function applyLocalData({ latest, history, catalog }) {
  state.latest = latest;
  state.history = history;
  state.catalog = catalog;
  state.funds = fundsFromLatest(latest, catalog);
  state.lastLocalReloadAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  state.localRefreshError = '';
}

async function reloadLocalData() {
  if (state.refreshBusy) {
    return;
  }
  state.refreshBusy = true;
  render();
  try {
    applyLocalData(await readLocalData());
  } catch (error) {
    state.localRefreshError = error instanceof Error ? error.message : String(error);
  } finally {
    state.refreshBusy = false;
    render();
  }
}

async function boot() {
  try {
    applyLocalData(await readLocalData());
    render();
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

boot();
