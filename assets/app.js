const app = document.querySelector('#app');

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

function fundCard(fund) {
  const changeValue = Number.isFinite(fund.predictedChangePct)
    ? fund.predictedChangePct
    : fund.estimatedChangePct;
  const message = fund.message
    ? `<p class="message">${escapeHtml(fund.message)}</p>`
    : '';

  return `
    <article class="fund-card">
      <div class="fund-head">
        <div>
          <h2 class="fund-name">${escapeHtml(fund.name)}</h2>
          <div class="fund-code">${escapeHtml(fund.code)}</div>
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
          <div class="label">盘中估值</div>
          <div class="value">${formatNumber(fund.estimatedNav)}</div>
        </div>
        <div class="metric">
          <div class="label">最新净值</div>
          <div class="value">${formatNumber(fund.nav)}</div>
        </div>
      </div>
      <p class="message">估值时间：${displayDateTime(fund.quoteTime)} · 净值日期：${displayDateTime(fund.navDate)}</p>
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

function render(latest, history) {
  const funds = Array.isArray(latest.funds) ? latest.funds : [];
  const records = Array.isArray(history.records)
    ? [...history.records].reverse().slice(0, 8)
    : [];
  const generatedAt = latest.generatedAt
    ? new Date(latest.generatedAt).toLocaleString('zh-CN', { hour12: false })
    : '暂无';

  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${escapeHtml(latest.tradingDate ?? '14:30 估算')}</p>
      <h1>基金收盘估算</h1>
      <p class="summary">${escapeHtml(latest.summary ?? '暂无最新摘要。')}</p>
      <p class="meta">更新时间：${escapeHtml(generatedAt)}</p>
    </section>
    <section class="fund-list">
      ${funds.length ? funds.map(fundCard).join('') : '<div class="notice">暂无基金数据。</div>'}
    </section>
    <h2 class="section-title">历史记录</h2>
    <section class="history-list">
      ${records.length ? records.map(historyCard).join('') : '<div class="notice">暂无历史记录。</div>'}
    </section>
    <p class="notice disclaimer">估算结果仅用于个人跟踪，不构成投资建议。实际净值以基金公司披露为准。</p>
  `;
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
    const [latest, history] = await Promise.all([
      fetch('data/latest.json', { cache: 'no-store' }).then(readJsonResponse),
      fetch('data/history.json', { cache: 'no-store' }).then(readJsonResponse),
    ]);
    render(latest, history);
  } catch (error) {
    app.innerHTML = `
      <section class="hero">
        <p class="eyebrow">14:30 估算</p>
        <h1>基金收盘估算</h1>
        <p class="summary">数据加载失败，请稍后刷新。</p>
      </section>
      <div class="notice">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>
    `;
  }
}

boot();
