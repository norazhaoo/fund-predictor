import { readFileSync } from 'node:fs';
import { resolveFundBenchmark } from '../assets/benchmark-rules.js';

export const TIME_ZONE = 'Asia/Shanghai';

const catalog = JSON.parse(readFileSync(new URL('../data/funds.json', import.meta.url), 'utf8'));

export const FUNDS = Object.freeze(catalog.funds.map((fund) => Object.freeze({
  code: String(fund.code).padStart(6, '0'),
  fallbackName: fund.fallbackName,
  holding: Boolean(fund.holding),
  group: fund.group ?? '',
  order: Number.isFinite(fund.order) ? fund.order : 0,
  benchmark: resolveFundBenchmark(fund),
})));
