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

test('predictFromQuote returns stale status when no intraday estimate exists', () => {
  const prediction = predictFromQuote({ ...quote, estimatedNav: null }, []);
  assert.equal(prediction.status, 'stale');
  assert.equal(prediction.predictedNav, null);
  assert.match(prediction.message, /没有可用的盘中估值/);
});
