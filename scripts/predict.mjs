const MIN_CALIBRATION_SAMPLES = 5;
const MAX_ABS_CALIBRATION = 0.01;
const MAX_ABS_BENCHMARK_ADJUSTMENT = 0.005;
const ESTIMATE_CONSISTENCY_TOLERANCE_PCT = 0.5;

function round4(value) {
  return Number(value.toFixed(4));
}

function round2(value) {
  return Number(value.toFixed(2));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function predictedChangePctFor(predictedNav, quote) {
  if (!Number.isFinite(quote.nav) || quote.nav === 0) {
    return quote.estimatedChangePct;
  }
  return round2(((predictedNav - quote.nav) / quote.nav) * 100);
}

function stableString(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isLowConfidenceGroup(quote) {
  const text = stableString(`${quote.group ?? ''} ${quote.name ?? ''}`);
  return text.includes('qdii') || text.includes('海外');
}

function estimateConsistencyFor(quote) {
  if (
    !Number.isFinite(quote.nav)
    || quote.nav === 0
    || !Number.isFinite(quote.estimatedNav)
    || !Number.isFinite(quote.estimatedChangePct)
  ) {
    return { consistent: true, impliedEstimateChangePct: null, estimateGapPct: null };
  }

  const impliedEstimateChangePct = round2(((quote.estimatedNav - quote.nav) / quote.nav) * 100);
  const estimateGapPct = round2(impliedEstimateChangePct - quote.estimatedChangePct);
  return {
    consistent: Math.abs(estimateGapPct) <= ESTIMATE_CONSISTENCY_TOLERANCE_PCT,
    impliedEstimateChangePct,
    estimateGapPct,
  };
}

function hasConfirmedOfficialNav(quote, tradingDate) {
  return Boolean(tradingDate)
    && quote.navDate === tradingDate
    && Number.isFinite(quote.nav)
    && Number.isFinite(quote.officialChangePct);
}

function unreliableEstimateFromQuote(quote, consistency) {
  return {
    ...quote,
    rawEstimatedNav: Number.isFinite(quote.rawEstimatedNav) ? quote.rawEstimatedNav : quote.estimatedNav,
    rawEstimatedChangePct: quote.estimatedChangePct,
    estimatedNav: null,
    estimatedChangePct: null,
    rawPredictedNav: null,
    predictedNav: null,
    predictedChangePct: null,
    calibration: 0,
    benchmarkAdjustment: 0,
    benchmarkGapPct: null,
    samplesUsed: 0,
    impliedEstimateChangePct: consistency.impliedEstimateChangePct,
    estimateGapPct: consistency.estimateGapPct,
    confidence: 'low',
    status: 'stale',
    message: `估算净值和估算涨跌不一致，差异 ${Math.abs(consistency.estimateGapPct).toFixed(2)}%，已暂停展示该估算。`,
  };
}

function confirmedPredictionFromQuote(quote) {
  return {
    ...quote,
    rawPredictedNav: null,
    predictedNav: round4(quote.nav),
    predictedChangePct: round2(quote.officialChangePct),
    calibration: 0,
    benchmarkAdjustment: 0,
    benchmarkGapPct: null,
    samplesUsed: 0,
    status: 'confirmed',
    message: '官方净值已确认，已按基金公司披露涨跌展示。',
  };
}

function proxySensitivityFor(quote) {
  if (Number.isFinite(quote.benchmark?.proxySensitivity)) {
    return quote.benchmark.proxySensitivity;
  }
  return 1;
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

function benchmarkAdjustmentFor(quote) {
  if (
    !Number.isFinite(quote.nav)
    || !Number.isFinite(quote.estimatedChangePct)
    || !Number.isFinite(quote.benchmark?.changePct)
    || !Number.isFinite(quote.benchmarkSensitivity)
    || quote.benchmarkSensitivity <= 0
  ) {
    return { benchmarkAdjustment: 0, benchmarkGapPct: null };
  }

  const benchmarkGapPct = round2(quote.benchmark.changePct - quote.estimatedChangePct);
  const rawAdjustment = quote.nav * (benchmarkGapPct / 100) * quote.benchmarkSensitivity;
  const capped = Math.max(
    -MAX_ABS_BENCHMARK_ADJUSTMENT,
    Math.min(MAX_ABS_BENCHMARK_ADJUSTMENT, rawAdjustment),
  );
  return {
    benchmarkAdjustment: round4(capped),
    benchmarkGapPct,
  };
}

export function predictFromQuote(quote, historyRecords, tradingDate = '') {
  if (hasConfirmedOfficialNav(quote, tradingDate)) {
    return confirmedPredictionFromQuote(quote);
  }

  const consistency = estimateConsistencyFor(quote);
  if (!consistency.consistent) {
    return unreliableEstimateFromQuote(quote, consistency);
  }

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

  const lowConfidence = isLowConfidenceGroup(quote);
  const { calibration, samplesUsed } = lowConfidence
    ? { calibration: 0, samplesUsed: 0 }
    : calibrationFor(quote.code, historyRecords);
  const { benchmarkAdjustment, benchmarkGapPct } = lowConfidence
    ? { benchmarkAdjustment: 0, benchmarkGapPct: null }
    : benchmarkAdjustmentFor(quote);
  const predictedNav = round4(quote.estimatedNav + calibration + benchmarkAdjustment);
  const hasBenchmarkAdjustment = benchmarkAdjustment !== 0;

  return {
    ...quote,
    rawPredictedNav: round4(quote.estimatedNav),
    predictedNav,
    predictedChangePct: predictedChangePctFor(predictedNav, quote),
    calibration,
    benchmarkAdjustment,
    benchmarkGapPct,
    samplesUsed,
    confidence: lowConfidence ? 'low' : undefined,
    status: 'ok',
    message: [
      lowConfidence ? 'QDII/海外基金估算受时区、汇率和净值滞后影响，按原始估算低置信展示，不做历史或指数修正。' : '',
      lowConfidence
        ? ''
        : samplesUsed >= MIN_CALIBRATION_SAMPLES
          ? '已使用历史误差做轻微校准。'
          : '历史样本不足，暂以盘中估值作为预测。',
      hasBenchmarkAdjustment ? '已加入参考指数偏离修正。' : '',
    ].filter(Boolean).join(' '),
  };
}

export function predictFromProxy(quote) {
  if (!Number.isFinite(quote.nav) || !Number.isFinite(quote.benchmark?.changePct)) {
    return null;
  }

  const proxySensitivity = proxySensitivityFor(quote);
  const proxyChangePct = round2(quote.benchmark.changePct * proxySensitivity);
  const predictedNav = round4(quote.nav * (1 + proxyChangePct / 100));
  const benchmarkName = quote.benchmark.name || '参考行情';

  return {
    ...quote,
    source: `proxy:${quote.benchmark.source ?? 'qt.gtimg.cn'}`,
    estimatedNav: null,
    estimatedChangePct: null,
    quoteTime: quote.quoteTime ?? quote.benchmark.quoteTime ?? null,
    rawPredictedNav: predictedNav,
    predictedNav,
    predictedChangePct: predictedChangePctFor(predictedNav, { ...quote, estimatedChangePct: proxyChangePct }),
    calibration: 0,
    benchmarkAdjustment: 0,
    benchmarkGapPct: null,
    samplesUsed: 0,
    proxyChangePct,
    proxySensitivity,
    predictionMethod: 'benchmark-proxy',
    confidence: 'low',
    status: 'proxy',
    message: `天天基金暂无盘中估值，已用${benchmarkName}做低置信替代估算。`,
  };
}
