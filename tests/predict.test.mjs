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
  assert.equal(prediction.predictedChangePct, 1.26);
});

test('predictFromQuote applies small benchmark divergence adjustment when configured', () => {
  const prediction = predictFromQuote({
    ...quote,
    nav: 2,
    estimatedNav: 2.04,
    estimatedChangePct: 2,
    benchmark: {
      secid: '1.000688',
      name: '科创50',
      changePct: 4,
      source: 'push2.eastmoney.com',
    },
    benchmarkSensitivity: 0.05,
  }, []);

  assert.equal(prediction.benchmarkGapPct, 2);
  assert.equal(prediction.benchmarkAdjustment, 0.002);
  assert.equal(prediction.predictedNav, 2.042);
  assert.match(prediction.message, /参考指数偏离修正/);
});

test('predictFromQuote refuses inconsistent estimate NAV and change fields', () => {
  const prediction = predictFromQuote({
    ...quote,
    code: '014002',
    name: '浦银安盛全球智能科技(QDII)C',
    nav: 4.0644,
    estimatedNav: 4.3583,
    estimatedChangePct: 0.02,
    quoteTime: '2026-07-02 04:00',
  }, []);

  assert.equal(prediction.status, 'stale');
  assert.equal(prediction.estimatedNav, null);
  assert.equal(prediction.estimatedChangePct, null);
  assert.equal(prediction.rawEstimatedNav, 4.3583);
  assert.equal(prediction.rawEstimatedChangePct, 0.02);
  assert.equal(prediction.predictedNav, null);
  assert.equal(prediction.predictedChangePct, null);
  assert.equal(prediction.estimateGapPct, 7.21);
  assert.match(prediction.message, /估算净值和估算涨跌不一致/);
});

test('predictFromQuote keeps QDII estimates low confidence without calibration or benchmark adjustment', () => {
  const history = [
    { code: '021842', predictedNav: 7.1, actualNav: 7.2 },
    { code: '021842', predictedNav: 7.2, actualNav: 7.3 },
    { code: '021842', predictedNav: 7.3, actualNav: 7.4 },
    { code: '021842', predictedNav: 7.4, actualNav: 7.5 },
    { code: '021842', predictedNav: 7.5, actualNav: 7.6 },
  ];
  const prediction = predictFromQuote({
    ...quote,
    code: '021842',
    name: '国富全球科技互联混合(QDII)人民币C',
    group: 'QDII',
    nav: 7.4062,
    estimatedNav: 7.4702,
    estimatedChangePct: 0.86,
    quoteTime: '2026-07-03 04:00',
    benchmark: {
      secid: 'usIXIC',
      name: '纳斯达克综合指数',
      changePct: -0.8,
    },
    benchmarkSensitivity: 0.05,
  }, history);

  assert.equal(prediction.status, 'ok');
  assert.equal(prediction.confidence, 'low');
  assert.equal(prediction.calibration, 0);
  assert.equal(prediction.benchmarkAdjustment, 0);
  assert.equal(prediction.predictedNav, 7.4702);
  assert.equal(prediction.predictedChangePct, 0.86);
  assert.match(prediction.message, /QDII/);
});

test('predictFromQuote returns stale status when no intraday estimate exists', () => {
  const prediction = predictFromQuote({ ...quote, estimatedNav: null }, []);
  assert.equal(prediction.status, 'stale');
  assert.equal(prediction.predictedNav, null);
  assert.match(prediction.message, /没有可用的盘中估值/);
});
