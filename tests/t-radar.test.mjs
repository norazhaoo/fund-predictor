import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTradeSignal,
  sortTradeRadarFunds,
} from '../assets/t-radar.js';

test('trade radar marks a sector pullback with stable benchmark as low-buy watch', () => {
  const signal = buildTradeSignal({
    code: '019633',
    name: '国泰半导体设备ETF联接C',
    group: '科技',
    status: 'ok',
    predictedChangePct: -1.6,
    benchmark: {
      name: '科创50',
      changePct: -0.2,
    },
  });

  assert.equal(signal.action, 'lowBuy');
  assert.equal(signal.label, '低吸观察');
  assert.equal(signal.targetHoldingDays, '7-14天');
  assert.ok(signal.score >= 75);
  assert.equal(signal.confidence, '中');
  assert.match(signal.reasons.join(' '), /盘中回调/);
  assert.match(signal.reasons.join(' '), /参考指数/);
});

test('trade radar warns when a fund is already overheated intraday', () => {
  const signal = buildTradeSignal({
    code: '017811',
    name: '高弹性科技主题C',
    group: '科技',
    status: 'ok',
    predictedChangePct: 4.2,
    benchmark: {
      name: '科创50',
      changePct: 3.8,
    },
  });

  assert.equal(signal.action, 'caution');
  assert.equal(signal.label, '冲高谨慎');
  assert.ok(signal.score < 60);
  assert.match(signal.risks.join(' '), /短线涨幅偏热/);
});

test('trade radar avoids fund types that do not fit A-share intraday T rhythm', () => {
  const signal = buildTradeSignal({
    code: '021842',
    name: '国富全球科技互联混合（QDII）人民币C',
    group: 'QDII',
    status: 'proxy',
    predictedChangePct: -1.4,
    benchmark: {
      name: '纳斯达克综合指数',
      changePct: -0.5,
    },
  });

  assert.equal(signal.action, 'avoid');
  assert.equal(signal.label, '回避');
  assert.equal(signal.confidence, '低');
  assert.match(signal.risks.join(' '), /QDII/);
  assert.match(signal.risks.join(' '), /替代估算/);
});

test('trade radar keeps neutral tradable funds inside the four signal labels', () => {
  const signal = buildTradeSignal({
    code: '005538',
    name: '中航新起航灵活配置混合C',
    group: '主动权益',
    status: 'ok',
    predictedChangePct: 0.2,
  });

  assert.equal(signal.action, 'hold');
  assert.equal(signal.label, '趋势持有');
  assert.equal(signal.targetHoldingDays, '7-14天');
});

test('trade radar sorting and filtering keep actionable signals first', () => {
  const sorted = sortTradeRadarFunds([
    {
      code: 'low-buy',
      name: '半导体ETF联接C',
      group: '科技',
      status: 'ok',
      predictedChangePct: -1.4,
      benchmark: { name: '科创50', changePct: -0.1 },
    },
    {
      code: 'hot',
      name: '新能源主题C',
      group: '新能源',
      status: 'ok',
      predictedChangePct: 4.5,
      benchmark: { name: '新能源指数', changePct: 3.2 },
    },
    {
      code: 'bond',
      name: '稳健债券A',
      group: '债券',
      status: 'ok',
      predictedChangePct: -0.2,
    },
  ], {
    actionFilter: 'actionable',
    groupFilter: 'all',
    query: '',
  });

  assert.deepEqual(sorted.map((fund) => fund.code), ['low-buy']);
  assert.equal(sorted[0].tradeSignal.label, '低吸观察');
});
