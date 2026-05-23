const MIN_CALIBRATION_SAMPLES = 5;
const MAX_ABS_CALIBRATION = 0.01;

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
    predictedChangePct: predictedChangePctFor(predictedNav, quote),
    calibration,
    samplesUsed,
    status: 'ok',
    message: samplesUsed >= MIN_CALIBRATION_SAMPLES
      ? '已使用历史误差做轻微校准。'
      : '历史样本不足，暂以盘中估值作为预测。',
  };
}
