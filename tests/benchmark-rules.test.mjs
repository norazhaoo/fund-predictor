import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFundBenchmark,
} from '../assets/benchmark-rules.js';

const hs300 = { secid: '1.000300', name: '沪深300', sensitivity: 0.03 };

test('benchmark rules map chip and semiconductor funds to chip ETF proxy', () => {
  const benchmark = resolveFundBenchmark({
    fallbackName: '华夏国证半导体芯片ETF联接C',
    group: '科技',
    benchmark: hs300,
  });

  assert.equal(benchmark.secid, '0.159995');
  assert.equal(benchmark.name, '芯片ETF');
  assert.ok(benchmark.sensitivity >= 0.8);
  assert.ok(benchmark.proxySensitivity >= 0.8);
});

test('benchmark rules map photovoltaic and robot funds to their sector proxies', () => {
  assert.equal(resolveFundBenchmark({
    fallbackName: '汇添富中证光伏产业ETF联接C',
    group: '新能源',
    benchmark: hs300,
  }).secid, '1.515790');

  assert.equal(resolveFundBenchmark({
    fallbackName: '招商中证机器人ETF联接C',
    group: '制造',
    benchmark: hs300,
  }).secid, '0.159770');
});

test('benchmark rules prefer Hang Seng Tech for Hong Kong technology funds', () => {
  const benchmark = resolveFundBenchmark({
    fallbackName: '天弘恒生科技ETF联接（QDII）C',
    group: 'QDII',
    benchmark: { secid: '100.HSI', name: '恒生指数', sensitivity: 0.05 },
  });

  assert.equal(benchmark.secid, '100.HSTECH');
  assert.equal(benchmark.name, '恒生科技指数');
});

test('benchmark rules do not assign A-share T proxies to bond funds', () => {
  assert.equal(resolveFundBenchmark({
    fallbackName: '鹏华可转债债券A',
    group: '债券',
  }), null);
});

test('benchmark rules keep global QDII funds on offshore proxies', () => {
  const benchmark = resolveFundBenchmark({
    fallbackName: '嘉实美国成长股票（QDII）',
    group: 'QDII',
    benchmark: { secid: 'usIXIC', name: '纳斯达克综合指数', sensitivity: 0.05 },
  });

  assert.equal(benchmark.secid, 'usIXIC');
  assert.equal(benchmark.name, '纳斯达克综合指数');
});

test('benchmark rules leave broad active growth funds on their configured benchmark', () => {
  const benchmark = resolveFundBenchmark({
    fallbackName: '银河创新成长混合A',
    group: '主动权益',
    benchmark: hs300,
  });

  assert.equal(benchmark.secid, '1.000300');
  assert.equal(benchmark.name, '沪深300');
});
