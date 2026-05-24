const MIN_CALIBRATION_SAMPLES = 5;
const MAX_ABS_CALIBRATION = 0.01;
const MAX_ABS_BENCHMARK_ADJUSTMENT = 0.005;

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
  const { benchmarkAdjustment, benchmarkGapPct } = benchmarkAdjustmentFor(quote);
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
    status: 'ok',
    message: [
      samplesUsed >= MIN_CALIBRATION_SAMPLES
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
