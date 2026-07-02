const ACTION_LABELS = {
  lowBuy: '低吸观察',
  hold: '趋势持有',
  caution: '冲高谨慎',
  avoid: '回避',
};

const ACTION_RANK = {
  lowBuy: 0,
  hold: 1,
  caution: 2,
  avoid: 3,
};

const TARGET_HOLDING_DAYS = '7-14天';

function stableString(value) {
  return String(value ?? '').trim().toLowerCase();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function changePctFor(fund) {
  if (fund.status === 'confirmed' && Number.isFinite(fund.officialChangePct)) {
    return fund.officialChangePct;
  }
  if (Number.isFinite(fund.predictedChangePct)) {
    return fund.predictedChangePct;
  }
  return Number.isFinite(fund.estimatedChangePct) ? fund.estimatedChangePct : null;
}

function benchmarkChangeFor(fund) {
  return Number.isFinite(fund.benchmark?.changePct) ? fund.benchmark.changePct : null;
}

function isUnsuitableGroup(group) {
  const text = stableString(group);
  return text.includes('qdii') || text.includes('债');
}

function isPreferredTGroup(group) {
  return ['科技', '新能源', '制造', '资源', '医药', '消费', '量化指数']
    .some((name) => stableString(group).includes(stableString(name)));
}

function pushUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function confidenceFor({ fund, changePct, benchmarkChangePct }) {
  if (
    fund.status === 'error'
    || fund.status === 'proxy'
    || fund.status === 'confirmed'
    || isUnsuitableGroup(fund.group)
    || !Number.isFinite(changePct)
  ) {
    return '低';
  }
  if (fund.status === 'ok' && Number.isFinite(benchmarkChangePct)) {
    return '中';
  }
  return '低';
}

export function buildTradeSignal(fund) {
  const changePct = changePctFor(fund);
  const benchmarkChangePct = benchmarkChangeFor(fund);
  const reasons = [];
  const risks = [];
  let score = 50;

  if (fund.status === 'error') {
    score -= 50;
    pushUnique(risks, '估值更新失败，暂不参与做T判断。');
  } else if (fund.status === 'proxy') {
    score -= 20;
    pushUnique(risks, '当前为替代估算，信号置信度低。');
  } else if (fund.status === 'confirmed') {
    score -= 45;
    pushUnique(risks, '官方净值已确认，不作为盘中做T信号。');
  } else if (fund.status === 'stale') {
    score -= 12;
    pushUnique(risks, '估值不是当前交易日，先等刷新。');
  } else if (fund.status === 'ok') {
    score += 12;
    pushUnique(reasons, '盘中估值可用。');
  }

  if (isUnsuitableGroup(fund.group)) {
    score -= 35;
    pushUnique(risks, `${fund.group || '该类别'}不适合按A股盘中节奏做T。`);
  } else if (isPreferredTGroup(fund.group)) {
    score += 8;
    pushUnique(reasons, `${fund.group}弹性较高，适合短线雷达观察。`);
  } else if (stableString(fund.group).includes('主动')) {
    score -= 4;
    pushUnique(risks, '主动权益持仓不透明，盘中估值误差可能偏大。');
  }

  const changeLabel = fund.status === 'confirmed' ? '确认' : '盘中';
  if (!Number.isFinite(changePct)) {
    score -= 25;
    pushUnique(risks, `缺少${changeLabel}涨跌数据。`);
  } else if (changePct <= -4) {
    score -= 25;
    pushUnique(risks, `${changeLabel}跌幅过深，可能不是普通回调。`);
  } else if (changePct <= -0.8) {
    score += 16;
    pushUnique(reasons, `${changeLabel}回调 ${changePct.toFixed(2)}%，有低吸窗口。`);
  } else if (changePct <= 0.5) {
    score += 8;
    pushUnique(reasons, `${changeLabel}波动不大，可以继续观察尾盘。`);
  } else if (changePct <= 2.4) {
    score += 10;
    pushUnique(reasons, `${changeLabel}上涨 ${changePct.toFixed(2)}%，趋势仍可观察。`);
  } else {
    score -= 24;
    pushUnique(risks, `${changeLabel}上涨 ${changePct.toFixed(2)}%，短线涨幅偏热。`);
  }

  if (Number.isFinite(benchmarkChangePct)) {
    const benchmarkName = fund.benchmark?.name || '参考指数';
    const relativeGap = benchmarkChangePct - (Number.isFinite(changePct) ? changePct : 0);
    pushUnique(reasons, `参考指数${benchmarkName} ${benchmarkChangePct >= 0 ? '+' : ''}${benchmarkChangePct.toFixed(2)}%。`);

    if (benchmarkChangePct < -2) {
      score -= 12;
      pushUnique(risks, '参考指数跌幅较大，尾盘承接需要确认。');
    } else if (benchmarkChangePct >= 3) {
      score -= 12;
      pushUnique(risks, '参考指数短线涨幅偏热，追涨性价比下降。');
    } else if (Number.isFinite(changePct) && changePct <= -0.8 && relativeGap >= 0.8) {
      score += 8;
      pushUnique(reasons, '基金弱于参考指数，存在尾盘修复预期。');
    } else if (benchmarkChangePct > 0 && Number.isFinite(changePct) && changePct > 0) {
      score += 5;
      pushUnique(reasons, '基金和参考指数同向走强。');
    }
  } else {
    score -= 5;
    pushUnique(risks, '缺少参考指数，做T信号只看基金估值。');
  }

  const finalScore = clampScore(score);
  const hot = Number.isFinite(changePct) && changePct >= 2.8
    || Number.isFinite(benchmarkChangePct) && benchmarkChangePct >= 3.2;
  let action = 'hold';
  if (
    isUnsuitableGroup(fund.group)
    || fund.status === 'error'
    || fund.status === 'proxy'
    || fund.status === 'confirmed'
  ) {
    action = 'avoid';
  } else if (hot) {
    action = 'caution';
  } else if (finalScore < 42) {
    action = 'avoid';
  } else if (finalScore >= 74 && Number.isFinite(changePct) && changePct <= -0.8) {
    action = 'lowBuy';
  } else if (finalScore >= 68) {
    action = 'hold';
  } else if (finalScore < 52) {
    action = 'avoid';
  }

  return {
    action,
    label: ACTION_LABELS[action],
    score: finalScore,
    targetHoldingDays: TARGET_HOLDING_DAYS,
    changePct,
    benchmarkChangePct,
    confidence: confidenceFor({ fund, changePct, benchmarkChangePct }),
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
  };
}

function matchesAction(signal, actionFilter) {
  if (!actionFilter || actionFilter === 'all') {
    return true;
  }
  if (actionFilter === 'actionable') {
    return signal.action === 'lowBuy' || signal.action === 'hold';
  }
  return signal.action === actionFilter;
}

function matchesGroup(fund, groupFilter) {
  const group = stableString(groupFilter);
  return !group || group === 'all' || stableString(fund.group) === group;
}

function matchesQuery(fund, query) {
  const text = stableString(query);
  if (!text) {
    return true;
  }
  return [fund.code, fund.name, fund.fallbackName, fund.group]
    .some((value) => stableString(value).includes(text));
}

export function sortTradeRadarFunds(funds, {
  actionFilter = 'all',
  groupFilter = 'all',
  query = '',
} = {}) {
  return funds
    .map((fund) => ({
      ...fund,
      tradeSignal: buildTradeSignal(fund),
    }))
    .filter((fund) => matchesAction(fund.tradeSignal, actionFilter))
    .filter((fund) => matchesGroup(fund, groupFilter))
    .filter((fund) => matchesQuery(fund, query))
    .toSorted((a, b) => {
      const actionDelta = ACTION_RANK[a.tradeSignal.action] - ACTION_RANK[b.tradeSignal.action];
      if (actionDelta !== 0) {
        return actionDelta;
      }
      const scoreDelta = b.tradeSignal.score - a.tradeSignal.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return stableString(a.code).localeCompare(stableString(b.code), 'zh-CN');
    });
}
