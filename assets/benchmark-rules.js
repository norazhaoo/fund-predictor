const BOND_PATTERN = /债|货币|现金|同业存单|理财/;
const INDEX_LIKE_PATTERN = /ETF|指数|联接|LOF|增强|期货|成份/;
const ACTIVE_SECTOR_GROUPS = ['科技', '新能源', '制造', '医药', '消费', '资源'];

const BENCHMARKS = {
  hs300: { secid: '1.000300', name: '沪深300', sensitivity: 0.25 },
  csiA500: { secid: '1.000510', name: '中证A500', sensitivity: 0.75, proxySensitivity: 0.8 },
  csi1000: { secid: '0.399852', name: '中证1000', sensitivity: 0.75, proxySensitivity: 0.8 },
  kcb50: { secid: '1.000688', name: '科创50', sensitivity: 0.8, proxySensitivity: 0.85 },
  chiNext: { secid: '0.399006', name: '创业板指', sensitivity: 0.75, proxySensitivity: 0.8 },
  chip: { secid: '0.159995', name: '芯片ETF', sensitivity: 0.9, proxySensitivity: 0.9 },
  ai: { secid: '0.159819', name: '人工智能ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  computer: { secid: '1.512720', name: '计算机ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  communication: { secid: '1.515050', name: '通信ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  newEnergyVehicle: { secid: '1.515030', name: '新能源车ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  battery: { secid: '0.159755', name: '电池ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  photovoltaic: { secid: '1.515790', name: '光伏ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  greenPower: { secid: '1.562550', name: '绿电ETF', sensitivity: 0.82, proxySensitivity: 0.85 },
  carbon: { secid: '1.516070', name: '碳中和ETF', sensitivity: 0.78, proxySensitivity: 0.82 },
  newEnergy: { secid: '1.516160', name: '新能源ETF', sensitivity: 0.82, proxySensitivity: 0.85 },
  innovativeDrug: { secid: '0.159992', name: '创新药ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  medicine: { secid: '1.512010', name: '医药ETF', sensitivity: 0.8, proxySensitivity: 0.85 },
  liquor: { secid: '0.399997', name: '中证白酒', sensitivity: 0.85, proxySensitivity: 0.85 },
  livestock: { secid: '0.159865', name: '养殖ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  broker: { secid: '1.512880', name: '证券ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  robot: { secid: '0.159770', name: '机器人ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  defense: { secid: '1.512660', name: '军工ETF', sensitivity: 0.82, proxySensitivity: 0.85 },
  infrastructure: { secid: '1.516970', name: '基建ETF', sensitivity: 0.82, proxySensitivity: 0.85 },
  equipment: { secid: '0.159638', name: '高端装备ETF', sensitivity: 0.8, proxySensitivity: 0.85 },
  rareEarth: { secid: '1.516150', name: '稀土ETF', sensitivity: 0.88, proxySensitivity: 0.9 },
  nonferrous: { secid: '0.159980', name: '有色ETF基金', sensitivity: 0.85, proxySensitivity: 0.88 },
  gold: { secid: '1.518880', name: '黄金ETF', sensitivity: 0.85, proxySensitivity: 0.88 },
  silver: { secid: '0.161226', name: '国投白银LOF', sensitivity: 0.85, proxySensitivity: 0.88 },
  chemical: { secid: '0.159981', name: '能源化工ETF基金', sensitivity: 0.82, proxySensitivity: 0.85 },
  coal: { secid: '1.515220', name: '煤炭ETF', sensitivity: 0.82, proxySensitivity: 0.85 },
  hsTech: { secid: '100.HSTECH', name: '恒生科技指数', sensitivity: 0.82, proxySensitivity: 0.88 },
  hsi: { secid: '100.HSI', name: '恒生指数', sensitivity: 0.65, proxySensitivity: 0.7 },
  nasdaq: { secid: 'usIXIC', name: '纳斯达克综合指数', sensitivity: 0.7, proxySensitivity: 0.75 },
  sp500: { secid: 'usINX', name: '标普500指数', sensitivity: 0.65, proxySensitivity: 0.7 },
  japan: { secid: 'usEWJ', name: 'MSCI日本ETF', sensitivity: 0.65, proxySensitivity: 0.7 },
};

const RULES = [
  { pattern: /恒生科技|香港科技|港股.*科技|中概互联网/, benchmark: BENCHMARKS.hsTech },
  { pattern: /港股|恒生|香港/, benchmark: BENCHMARKS.hsi },
  { pattern: /标普500|S&P\s*500/i, benchmark: BENCHMARKS.sp500 },
  { pattern: /日本/, benchmark: BENCHMARKS.japan },
  { pattern: /纳斯达克|QDII|美国|全球|海外|标普信息科技|移动互联|互联网.*QDII/i, benchmark: BENCHMARKS.nasdaq },
  { pattern: /半导体|芯片|集成电路/, benchmark: BENCHMARKS.chip },
  { pattern: /人工智能|AI/i, benchmark: BENCHMARKS.ai },
  { pattern: /5G|通信|物联|卫星/, benchmark: BENCHMARKS.communication },
  { pattern: /计算机|软件|数字经济|电子信息|电子|互联网|科技创新|科技精选/, benchmark: BENCHMARKS.computer },
  { pattern: /光伏/, benchmark: BENCHMARKS.photovoltaic },
  { pattern: /电池/, benchmark: BENCHMARKS.battery },
  { pattern: /新能源车|新能源汽车|汽车/, benchmark: BENCHMARKS.newEnergyVehicle },
  { pattern: /绿色电力|绿电|电网|公用事业/, benchmark: BENCHMARKS.greenPower },
  { pattern: /碳中和|低碳|环保|清洁能源/, benchmark: BENCHMARKS.carbon },
  { pattern: /新能源|能源主题/, benchmark: BENCHMARKS.newEnergy },
  { pattern: /创新药/, benchmark: BENCHMARKS.innovativeDrug },
  { pattern: /医药|医疗|健康/, benchmark: BENCHMARKS.medicine },
  { pattern: /白酒/, benchmark: BENCHMARKS.liquor },
  { pattern: /畜牧|养殖/, benchmark: BENCHMARKS.livestock },
  { pattern: /证券公司|证券/, benchmark: BENCHMARKS.broker },
  { pattern: /机器人/, benchmark: BENCHMARKS.robot },
  { pattern: /军工|国防/, benchmark: BENCHMARKS.defense },
  { pattern: /基建/, benchmark: BENCHMARKS.infrastructure },
  { pattern: /高端装备|先进制造|制造升级|工业4\.0|装备/, benchmark: BENCHMARKS.equipment },
  { pattern: /稀土|稀有金属/, benchmark: BENCHMARKS.rareEarth },
  { pattern: /有色/, benchmark: BENCHMARKS.nonferrous },
  { pattern: /黄金|上海金|金银珠宝/, benchmark: BENCHMARKS.gold },
  { pattern: /白银/, benchmark: BENCHMARKS.silver },
  { pattern: /能源化工|化工/, benchmark: BENCHMARKS.chemical },
  { pattern: /煤炭/, benchmark: BENCHMARKS.coal },
  { pattern: /A500/i, benchmark: BENCHMARKS.csiA500 },
  { pattern: /中证1000/, benchmark: BENCHMARKS.csi1000 },
  { pattern: /科创50|科创板50|科创创业50/, benchmark: BENCHMARKS.kcb50 },
  { pattern: /创业板/, benchmark: BENCHMARKS.chiNext },
  { pattern: /科技/, benchmark: BENCHMARKS.kcb50 },
];

function stableText(value) {
  return String(value ?? '').trim();
}

function textForFund(fund) {
  return [
    fund?.fallbackName,
    fund?.name,
    fund?.group,
  ].map(stableText).filter(Boolean).join(' ');
}

function isBondLike(fund) {
  return BOND_PATTERN.test(textForFund(fund));
}

function isIndexLike(fund) {
  return INDEX_LIKE_PATTERN.test(textForFund(fund));
}

function isActiveSectorGroup(fund) {
  const group = stableText(fund?.group);
  return ACTIVE_SECTOR_GROUPS.some((name) => group.includes(name));
}

function normalizeBenchmark(benchmark) {
  if (!benchmark?.secid) {
    return null;
  }
  return {
    secid: String(benchmark.secid),
    name: stableText(benchmark.name),
    sensitivity: Number.isFinite(benchmark.sensitivity) ? benchmark.sensitivity : 0,
    ...(Number.isFinite(benchmark.proxySensitivity)
      ? { proxySensitivity: benchmark.proxySensitivity }
      : {}),
  };
}

function tuneSensitivity(benchmark, fund) {
  if (isIndexLike(fund)) {
    return benchmark;
  }
  if (isActiveSectorGroup(fund)) {
    return {
      ...benchmark,
      sensitivity: Math.min(benchmark.sensitivity, 0.55),
      ...(Number.isFinite(benchmark.proxySensitivity)
        ? { proxySensitivity: Math.min(benchmark.proxySensitivity, 0.6) }
        : {}),
    };
  }
  return benchmark;
}

export function resolveFundBenchmark(fund) {
  if (isBondLike(fund)) {
    return null;
  }

  const text = textForFund(fund);
  const matchedRule = RULES.find((rule) => rule.pattern.test(text));
  if (matchedRule) {
    return tuneSensitivity(matchedRule.benchmark, fund);
  }

  return normalizeBenchmark(fund?.benchmark);
}
