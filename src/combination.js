import { computeIndicators } from './indicators.js';
import { intervals, validateOptions, validateCandles, simulate, metrics } from './backtest.js';
import { detectPattern, patternCatalog } from './patterns.js';

export const combinationIntervals = ['15m', '1h', '4h', '1d'];
export const conditionCatalog = {
  emaGolden: 'EMA50 上穿 EMA200（黃金交叉）',
  emaDeath: 'EMA50 下穿 EMA200（死亡交叉）',
  macdGolden: 'MACD 上穿訊號線（黃金交叉）',
  macdDeath: 'MACD 下穿訊號線（死亡交叉）',
  rsiOverbought: 'RSI ≥ 超買門檻', rsiOversold: 'RSI ≤ 超賣門檻',
  bbUpper: '收盤價 ≥ 布林上軌', bbLower: '收盤價 ≤ 布林下軌',
  ...patternCatalog,
};
export function validateCombination(combination) {
  if (!combination || !['long', 'short'].includes(combination.side)) throw new Error('請選擇做多或做空');
  const { conditions } = combination;
  if (!Array.isArray(conditions) || !conditions.length || conditions.length > 32) throw new Error('請勾選 1 至 32 個 AND 條件');
  const seen = new Set();
  for (const c of conditions) {
    if (!c || !combinationIntervals.includes(c.interval) || !Object.hasOwn(conditionCatalog, c.type)) throw new Error('條件或週期無效');
    const key = `${c.interval}:${c.type}`;
    if (seen.has(key)) throw new Error('條件不可重複');
    seen.add(key);
    if (c.type.startsWith('rsi') && (!Number.isFinite(c.threshold) || c.threshold < 0 || c.threshold > 100)) throw new Error('RSI 門檻必須介於 0 與 100');
  }
  return combination;
}
export function executionInterval(combination, market) {
  validateCombination(combination);
  const smallest = Math.min(...combination.conditions.map(c => intervals[c.interval]), market === 'futures' ? intervals['1h'] : Infinity);
  return combinationIntervals.find(t => intervals[t] === smallest);
}
// Indices refer to a native timeframe, never a forward-filled indicator series.
export function conditionMatches(condition, indicators, index, freshClose, candles) {
  const value = key => indicators[key]?.[index];
  const cross = (a, b, up) => {
    const prevA = indicators[a]?.[index - 1], prevB = indicators[b]?.[index - 1];
    if (!freshClose || ![value(a), value(b), prevA, prevB].every(Number.isFinite)) return false;
    return up ? prevA <= prevB && value(a) > value(b) : prevA >= prevB && value(a) < value(b);
  };
  if (Object.hasOwn(patternCatalog, condition.type)) return !!freshClose && detectPattern(candles, index, condition.type);
  switch (condition.type) {
    case 'emaGolden': return cross('ema50', 'ema200', true);
    case 'emaDeath': return cross('ema50', 'ema200', false);
    case 'macdGolden': return cross('macd', 'macdSignal', true);
    case 'macdDeath': return cross('macd', 'macdSignal', false);
    case 'rsiOverbought': return Number.isFinite(value('rsi')) && value('rsi') >= condition.threshold;
    case 'rsiOversold': return Number.isFinite(value('rsi')) && value('rsi') <= condition.threshold;
    case 'bbUpper': return [value('close'), value('bbUpper')].every(Number.isFinite) && value('close') >= value('bbUpper');
    case 'bbLower': return [value('close'), value('bbLower')].every(Number.isFinite) && value('close') <= value('bbLower');
    default: return false;
  }
}
export function buildCombinationSignals(base, timeframes, combination, baseInterval) {
  validateCombination(combination);
  const frames = Object.fromEntries([...new Set(combination.conditions.map(c => c.interval))].map(interval => {
    const candles = timeframes[interval];
    if (!Array.isArray(candles) || !candles.length) throw new Error(`缺少 ${interval} 已收盤 K 線`);
    validateCandles(candles, intervals[interval]);
    return [interval, { candles, indicators: computeIndicators(candles), index: -1 }];
  }));
  const signals = new Uint8Array(base.length), ready = new Uint8Array(base.length);
  const conditionHits = combination.conditions.map(() => 0);
  let combinedHits = 0, readyBars = 0;
  for (let i = 0; i < base.length; i++) {
    const decisionTime = base[i].time + intervals[baseInterval];
    for (const [interval, frame] of Object.entries(frames)) {
      while (frame.index + 1 < frame.candles.length && frame.candles[frame.index + 1].time + intervals[interval] <= decisionTime) frame.index++;
    }
    // Require 200 completed candles in every selected timeframe, including the current close.
    ready[i] = Number(Object.values(frames).every(f => f.index >= 199));
    if (!ready[i]) continue;
    readyBars++;
    const matchesByCondition = combination.conditions.map((c, conditionIndex) => {
      const f = frames[c.interval];
      const fresh = f.candles[f.index].time + intervals[c.interval] === decisionTime;
      const matched = conditionMatches(c, f.indicators, f.index, fresh, f.candles);
      if (matched) conditionHits[conditionIndex]++;
      return matched;
    });
    const matches = matchesByCondition.every(Boolean);
    if (matches) {
      combinedHits++;
      signals[i] = combination.side === 'long' ? 1 : 2;
    }
  }
  return { signals, ready, diagnostics: { readyBars, combinedHits, conditionHits } };
}
export function allAssetsPositive(assets, selectedSymbols) {
  return selectedSymbols.length > 0 && assets.length === selectedSymbols.length && new Set(assets.map(a => a.symbol)).size === selectedSymbols.length && selectedSymbols.every(symbol => {
    const asset = assets.find(a => a.symbol === symbol);
    return asset && Number.isFinite(asset.totalReturn) && asset.totalReturn > 0 && asset.trades > 0;
  });
}
export function analyzeCombination(raw, options, onProgress = () => {}) {
  validateOptions(options);
  const combination = validateCombination(options.combination);
  if (options.market === 'spot' && combination.side === 'short') throw new Error('做空請切換至永續合約');
  if (options.interval !== executionInterval(combination, options.market)) throw new Error('成交週期必須使用最小條件週期（合約至多 1h）');
  if (!Array.isArray(raw) || !raw.length || raw.length > 15 || new Set(raw.map(d => d.symbol)).size !== raw.length) throw new Error('請選擇 1 至 15 個不同幣種');
  if (new Set(raw.map(d => d.quote)).size !== 1) throw new Error('幣種必須使用相同報價幣');
  if (![options.startTime, options.endTime].every(Number.isSafeInteger) || options.startTime >= options.endTime) throw new Error('日期範圍無效');
  const step = intervals[options.interval], cutoff = Math.min(options.endTime, Math.floor(Date.now() / step) * step);
  const data = raw.map(d => {
    const candles = d.candles.filter(c => c.time + step <= cutoff);
    validateCandles(candles, step);
    if (candles.length < 300) throw new Error(`${d.symbol} 資料不足，需 200 根暖機與 100 根研究 K 線`);
    if (options.market === 'futures') {
      if (!Array.isArray(d.funding) || !candles.every(c => [c.markOpen, c.markHigh, c.markLow, c.markClose].every(v => Number.isFinite(v) && v > 0) && c.markHigh >= Math.max(c.markOpen, c.markClose) && c.markLow <= Math.min(c.markOpen, c.markClose))) throw new Error('合約回測需要有效標記價格與資金費率');
      for (let i = 0; i < d.funding.length; i++) {
        const f = d.funding[i];
        if (![f.time, f.rate, f.markPrice].every(Number.isFinite) || f.markPrice <= 0 || (i && f.time <= d.funding[i - 1].time)) throw new Error('資金費率事件無效');
      }
    }
    const timeframes = { ...d.timeframes, [options.interval]: candles };
    for (const interval of new Set(combination.conditions.map(c => c.interval))) {
      if (!Array.isArray(timeframes[interval])) throw new Error(`${d.symbol} 缺少 ${interval} 資料`);
      timeframes[interval] = timeframes[interval].filter(c => c.time + intervals[interval] <= cutoff);
    }
    const { signals, ready, diagnostics } = buildCombinationSignals(candles, timeframes, combination, options.interval);
    const from = candles.findIndex((c, i) => i >= 200 && c.time >= options.startTime && ready[i - 1]);
    if (from < 0) throw new Error(`${d.symbol} 跨週期暖機不足`);
    return { ...d, candles, indicators: computeIndicators(candles), signals, from, signalDiagnostics: diagnostics };
  });
  if (data.reduce((sum, d) => sum + d.candles.length + Object.values(d.timeframes ?? {}).reduce((n, cs) => n + cs.length, 0), 0) > 320000) throw new Error('含跨週期暖機資料最多 320,000 根 K 線');
  const commonStart = Math.max(...data.map(d => d.candles[d.from].time));
  const commonEnd = Math.min(...data.map(d => d.candles.at(-1).time));
  const bars = Math.round((commonEnd - commonStart) / step) + 1;
  if (bars < 100) throw new Error('共同可用期間不足 100 根 K 線，請增加日期範圍');
  const best = { id: 'combination', name: '條件組合回測', params: {}, indicators: '跨週期 AND', combination };
  const parts = data.map((d, index) => {
    const start = d.candles.findIndex(c => c.time === commonStart), end = d.candles.findIndex(c => c.time === commonEnd) + 1;
    if (start < 0 || end <= start || end - start !== bars) throw new Error('跨幣種 K 線無法對齊');
    const part = simulate(d, best, { ...options, capital: options.capital / data.length }, { start, end }, d.signals);
    onProgress(Math.round((index + 1) / data.length * 100), `條件組合 ${index + 1} / ${data.length}`);
    return { ...part, dataset: d, start, end };
  });
  const equity = parts[0].equity.map((p, i) => ({ time: p.time, value: parts.reduce((s, r) => s + r.equity[i].value, 0) }));
  const trades = parts.flatMap(p => p.trades).sort((a, b) => a.exitTime - b.exitTime);
  const stats = metrics(equity, trades, options.capital, step);
  stats.exposure = parts.reduce((s, p) => s + p.stats.exposure, 0) / parts.length;
  const assets = parts.map((p, i) => ({ symbol: data[i].symbol, ...p.stats }));
  const full = { equity, trades, stats, assets, allPositive: allAssetsPositive(assets, raw.map(d => d.symbol)), benchmark: equity.map((p, i) => ({ time: p.time, value: parts.reduce((sum, r) => {
    const entry = r.dataset.candles[r.start].open * (1 + options.slippage);
    const qty = options.capital / parts.length / (entry * (1 + options.fee));
    return sum + qty * r.dataset.candles[r.start + i].close * (i === bars - 1 ? (1 - options.slippage) * (1 - options.fee) : 1);
  }, 0) })) };
  return { options, best, full, test: full, ranking: [{ strategy: best, train: stats, test: stats }], folds: [], snapshot: {}, metadata: {
    mode: 'combination', generatedAt: new Date().toISOString(), sources: raw.map(d => ({ symbol: d.symbol, source: d.source, fetchedAt: d.fetchedAt })),
    symbols: raw.map(d => d.symbol), start: commonStart, end: commonEnd, bars, candidates: 1,
    commonPeriodTrimmed: commonStart > options.startTime + step,
    signalDiagnostics: data.map(d => ({
      symbol: d.symbol,
      readyBars: d.signalDiagnostics.readyBars,
      combinedHits: d.signalDiagnostics.combinedHits,
      conditions: combination.conditions.map((condition, i) => ({ ...condition, hits: d.signalDiagnostics.conditionHits[i] })),
    })),
    warnings: ['本報告為指定條件的完整期間回測，沒有自動選參數或樣本外排名。', '交叉僅在該週期交叉收盤時成立；狀態條件採最新已收盤值。', '各幣等額配置獨立帳戶；零交易、零報酬均不算正報酬。', '停損停利同根觸及時停損優先；跳空採開盤價。', '重複測試可能過度擬合；歷史獲利不保證未來。'],
  } };
}


const searchLongTypes = ['emaGolden','macdGolden','rsiOversold','bbLower','hammer','invertedHammer','bullishEngulfing','morningStar','doji'];
const searchShortTypes = ['emaDeath','macdDeath','rsiOverbought','bbUpper','hangingMan','shootingStar','bearishEngulfing','eveningStar','doji'];
const searchRsiThresholds = { rsiOverbought: [70, 75, 80], rsiOversold: [30, 25, 20] };
const searchRiskStops = [.01, .02, .03, .05], searchRiskTargets = [.01, .02, .03, .05, .10];

function atomKey(c) { return `${c.interval}:${c.type}:${c.threshold ?? ''}`; }
function simpleHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function combinationsOf(items, length, start = 0, prefix = [], out = []) {
  if (prefix.length === length) { out.push(prefix.slice()); return out; }
  for (let i = start; i <= items.length - (length - prefix.length); i++) {
    prefix.push(items[i]); combinationsOf(items, length, i + 1, prefix, out); prefix.pop();
  }
  return out;
}
function validSearchConditionSet(conditions) {
  const families = new Set();
  for (const c of conditions) {
    const family = `${c.interval}:${c.type}`;
    if (families.has(family)) return false;
    families.add(family);
  }
  return true;
}
function buildSearchAtoms(side) {
  const types = side === 'long' ? searchLongTypes : searchShortTypes;
  return combinationIntervals.flatMap(interval => types.flatMap(type =>
    searchRsiThresholds[type]
      ? searchRsiThresholds[type].map(threshold => ({ interval, type, threshold }))
      : [{ interval, type }]
  ));
}
export function generateSearchCandidates(config = {}, market = 'futures') {
  const maxConditions = Math.max(1, Math.min(4, Number(config.maxConditions ?? 3)));
  const maxCandidates = Math.max(12, Math.min(500, Number(config.maxCandidates ?? 180)));
  const sides = config.side === 'long' ? ['long'] : config.side === 'short' ? ['short'] : market === 'spot' ? ['long'] : ['long', 'short'];
  if (market === 'spot' && sides.includes('short')) throw new Error('現貨自動搜尋不能包含做空');
  const riskSearch = !!config.riskSearch;
  const fixedStop = Number(config.stopLoss ?? .02), fixedTarget = Number(config.takeProfit ?? .04);
  const risks = riskSearch
    ? searchRiskStops.flatMap(stopLoss => searchRiskTargets.map(takeProfit => ({ stopLoss, takeProfit })))
    : [{ stopLoss: fixedStop, takeProfit: fixedTarget }];
  const perRiskBudget = Math.max(1, Math.ceil(maxCandidates / risks.length));
  const grouped = Array.from({ length: maxConditions }, () => []);
  for (const side of sides) {
    const atoms = buildSearchAtoms(side);
    for (let length = 1; length <= maxConditions; length++) {
      for (const conditions of combinationsOf(atoms, length)) {
        if (!validSearchConditionSet(conditions)) continue;
        const key = `${side}|${conditions.map(atomKey).join('|')}`;
        grouped[length - 1].push({ side, conditions, key, hash: simpleHash(key) });
      }
    }
  }
  for (const group of grouped) group.sort((a, b) => a.hash - b.hash || a.key.localeCompare(b.key));
  const chosen = [];
  const quota = Math.max(1, Math.floor(perRiskBudget / grouped.length));
  for (const group of grouped) chosen.push(...group.slice(0, quota));
  if (chosen.length < perRiskBudget) {
    const used = new Set(chosen.map(c => c.key));
    const rest = grouped.flat().filter(c => !used.has(c.key)).sort((a, b) => a.hash - b.hash || a.key.localeCompare(b.key));
    chosen.push(...rest.slice(0, perRiskBudget - chosen.length));
  }
  const candidates = [];
  for (const base of chosen.slice(0, perRiskBudget)) {
    for (const risk of risks) {
      if (candidates.length >= maxCandidates) break;
      candidates.push({
        id: `search:${base.side}:${simpleHash(base.key + ':' + risk.stopLoss + ':' + risk.takeProfit).toString(36)}`,
        combination: { side: base.side, conditions: base.conditions.map(c => ({ ...c })) },
        stopLoss: risk.stopLoss, takeProfit: risk.takeProfit,
      });
    }
    if (candidates.length >= maxCandidates) break;
  }
  return { candidates, totalSpace: grouped.reduce((s, g) => s + g.length, 0) * risks.length, riskProfiles: risks.length };
}
function positiveRatio(assets) {
  return assets.length ? assets.filter(a => a.trades > 0 && a.totalReturn > 0).length / assets.length : 0;
}
function boundedPf(stats) {
  if (stats.noLosses && stats.trades) return 8;
  return Number.isFinite(stats.profitFactor) ? Math.min(8, Math.max(0, stats.profitFactor)) : 0;
}
export function scoreSearchResult(report, minTrades = 20) {
  const s = report.stats, consistency = positiveRatio(report.assets);
  const eligible = s.trades >= minTrades && s.liquidations === 0;
  const samplePenalty = s.trades >= minTrades ? 0 : (minTrades - s.trades) * 25;
  const liquidationPenalty = s.liquidations * 250;
  const winRateScore = (eligible ? 0 : -100000) + s.winRate + Math.min(s.trades, 200) / 1000 - Math.abs(s.maxDrawdown) / 1000;
  const returnScore = (eligible ? 0 : -100000) + s.totalReturn + consistency * .0001 - Math.abs(s.maxDrawdown) * .000001 - liquidationPenalty;
  const stabilityScore = (eligible ? 0 : -100000)
    + (s.sharpe ?? -3) * 2
    + (s.sortino ?? -3) * .45
    + Math.log1p(boundedPf(s)) * 2
    + consistency * 6
    - Math.abs(s.maxDrawdown) / 10
    + Math.min(s.trades, 120) / 120
    - samplePenalty - liquidationPenalty;
  return { eligible, consistency, winRateScore, returnScore, stabilityScore };
}
export function pickSearchWinners(ranking, minTrades = 20) {
  const eligible = ranking.filter(r => r.trainScore?.eligible && r.train?.trades >= minTrades);
  const source = eligible.length ? eligible : [];
  const pick = key => source.length ? [...source].sort((a, b) => b.trainScore[key] - a.trainScore[key])[0] : null;
  return { winRate: pick('winRateScore'), stability: pick('stabilityScore'), return: pick('returnScore') };
}
function candidateDescription(candidate) {
  return candidate.combination.conditions.map(c => `${c.interval} ${conditionCatalog[c.type]}${c.type.startsWith('rsi') ? ` ${c.threshold}` : ''}`).join(' ＋ ');
}
function explainSearchCandidate(row, kind, minTrades) {
  const t = row.train, h = row.test, consistency = Math.round(row.trainScore.consistency * 100);
  const why = kind === 'winRate'
    ? `訓練段勝率 ${t.winRate.toFixed(1)}%，且有 ${t.trades} 筆交易，已通過最少 ${minTrades} 筆門檻；跨幣正報酬比例約 ${consistency}%。`
    : kind === 'return'
      ? `訓練段淨報酬 ${t.totalReturn.toFixed(2)}%，在通過最低交易數且沒有估計清算的候選中最高；回撤與跨幣一致性另外列出，不拿來偷改「獲利最多」的定義。`
      : `訓練段以 Sharpe、Sortino、獲利因子、最大回撤、交易數與跨幣一致性綜合評分最高；不是只追求單一高勝率。`;
  const risks = [];
  if (h.trades < minTrades) risks.push(`樣本外只有 ${h.trades} 筆交易，證據仍偏少`);
  if (h.totalReturn < 0) risks.push(`樣本外報酬 ${h.totalReturn.toFixed(2)}%，未延續訓練段表現`);
  if (h.maxDrawdown < -15) risks.push(`樣本外最大回撤達 ${h.maxDrawdown.toFixed(2)}%`);
  if (row.testScore.consistency < .6) risks.push(`樣本外只有約 ${Math.round(row.testScore.consistency * 100)}% 幣種為正報酬`);
  if (h.liquidations) risks.push(`樣本外出現 ${h.liquidations} 次估計清算`);
  if (!risks.length) risks.push('樣本外仍不代表未來；大量候選搜尋本身會提高過度擬合風險');
  return { why, risk: risks.join('；') + '。' };
}
function buildMask(base, baseInterval, frame, condition) {
  const mask = new Uint8Array(base.length);
  let index = -1;
  for (let i = 0; i < base.length; i++) {
    const decisionTime = base[i].time + intervals[baseInterval];
    while (index + 1 < frame.candles.length && frame.candles[index + 1].time + intervals[condition.interval] <= decisionTime) index++;
    if (index < 199) continue;
    const fresh = frame.candles[index].time + intervals[condition.interval] === decisionTime;
    if (conditionMatches(condition, frame.indicators, index, fresh, frame.candles)) mask[i] = 1;
  }
  return mask;
}
function searchPortfolio(data, candidate, options, range, masksByAsset) {
  const parts = data.map((d, assetIndex) => {
    const start = d.candles.findIndex(c => c.time === range.startTime);
    const endIndex = d.candles.findIndex(c => c.time === range.endTime);
    const end = endIndex < 0 ? d.candles.length : endIndex;
    if (start < 0 || end <= start) throw new Error('自動搜尋跨幣種 K 線無法按時間對齊');
    const signals = new Uint8Array(d.candles.length), masks = masksByAsset[assetIndex];
    for (let i = start; i < end; i++) {
      let match = true;
      for (const c of candidate.combination.conditions) if (!masks.get(atomKey(c))[i]) { match = false; break; }
      if (match) signals[i] = candidate.combination.side === 'long' ? 1 : 2;
    }
    return simulate(d, { id: candidate.id }, {
      ...options, capital: options.capital / data.length, stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit, trailingStop: 0,
    }, { start, end }, signals);
  });
  const equity = parts[0].equity.map((p, i) => ({ time: p.time, value: parts.reduce((s, r) => s + r.equity[i].value, 0) }));
  const trades = parts.flatMap(p => p.trades).sort((a, b) => a.exitTime - b.exitTime);
  const stats = metrics(equity, trades, options.capital, intervals[options.interval]);
  stats.exposure = parts.reduce((s, p) => s + p.stats.exposure, 0) / parts.length;
  return { equity, trades, stats, assets: parts.map((p, i) => ({ symbol: data[i].symbol, ...p.stats })) };
}
export function analyzeCombinationSearch(raw, options, onProgress = () => {}) {
  validateOptions(options);
  if (options.interval !== '15m') throw new Error('條件組合自動搜尋固定使用 15m 作成交執行週期');
  if (!Array.isArray(raw) || !raw.length || raw.length > 15 || new Set(raw.map(d => d.symbol)).size !== raw.length) throw new Error('請選擇 1 至 15 個不同幣種');
  if (new Set(raw.map(d => d.quote)).size !== 1) throw new Error('幣種必須使用相同報價幣');
  const config = {
    maxConditions: Number(options.search?.maxConditions ?? 3),
    maxCandidates: Number(options.search?.maxCandidates ?? 180),
    minTrades: Number(options.search?.minTrades ?? 20),
    side: options.search?.side ?? 'auto',
    riskSearch: !!options.search?.riskSearch,
    stopLoss: options.stopLoss, takeProfit: options.takeProfit,
  };
  if (!Number.isInteger(config.minTrades) || config.minTrades < 1 || config.minTrades > 500) throw new Error('最低交易數必須介於 1 與 500');
  const generated = generateSearchCandidates(config, options.market);
  const cutoff = Math.min(options.endTime, Math.floor(Date.now() / intervals['15m']) * intervals['15m']);
  const data = raw.map(d => {
    const candles = d.candles.filter(c => c.time + intervals['15m'] <= cutoff);
    validateCandles(candles, intervals['15m']);
    if (candles.length < 300) throw new Error(`${d.symbol} 15m 資料不足`);
    if (options.market === 'futures') {
      if (!Array.isArray(d.funding) || !candles.every(c => [c.markOpen, c.markHigh, c.markLow, c.markClose].every(v => Number.isFinite(v) && v > 0))) throw new Error('合約搜尋需要有效標記價格與資金費率');
    }
    const timeframes = { ...(d.timeframes ?? {}), '15m': candles };
    const frames = {};
    for (const interval of combinationIntervals) {
      const frameCandles = interval === '15m' ? candles : timeframes[interval];
      if (!Array.isArray(frameCandles) || !frameCandles.length) throw new Error(`${d.symbol} 缺少 ${interval} 搜尋資料`);
      const filtered = frameCandles.filter(c => c.time + intervals[interval] <= cutoff);
      validateCandles(filtered, intervals[interval]);
      frames[interval] = { candles: filtered, indicators: computeIndicators(filtered) };
    }
    return { ...d, candles, indicators: frames['15m'].indicators, searchFrames: frames };
  });
  if (data.reduce((sum, d) => sum + Object.values(d.searchFrames).reduce((n, f) => n + f.candles.length, 0), 0) > 420000) throw new Error('自動搜尋跨週期資料超過 420,000 根，請縮短期間或減少幣種');
  const commonStart = Math.max(...data.map(d => d.candles.find(c => c.time >= options.startTime)?.time ?? Infinity));
  const commonEnd = Math.min(...data.map(d => d.candles.at(-1).time));
  if (!Number.isFinite(commonStart) || commonEnd <= commonStart) throw new Error('沒有共同可用的搜尋期間');
  const bars = Math.round((commonEnd - commonStart) / intervals['15m']) + 1;
  if (bars < 160) throw new Error('自動搜尋至少需要 160 根共同研究 K 線與暖機資料');
  for (const d of data) {
    const startIndex = d.candles.findIndex(c => c.time === commonStart);
    const endIndex = d.candles.findIndex(c => c.time === commonEnd);
    if (startIndex < 200 || endIndex < startIndex || endIndex - startIndex + 1 !== bars) throw new Error('跨幣種 15m K 線無法按共同時間對齊');
  }
  const splitBars = Math.floor(bars * .7);
  const splitTime = commonStart + splitBars * intervals['15m'];
  const endExclusive = commonEnd + intervals['15m'];
  const usedAtoms = new Map();
  for (const candidate of generated.candidates) for (const c of candidate.combination.conditions) usedAtoms.set(atomKey(c), c);
  const masksByAsset = data.map((d, assetIndex) => {
    onProgress(Math.round(assetIndex / data.length * 8), `建立 ${d.symbol} 條件快取`);
    const masks = new Map();
    for (const [key, condition] of usedAtoms) masks.set(key, buildMask(d.candles, '15m', d.searchFrames[condition.interval], condition));
    return masks;
  });
  const ranking = generated.candidates.map((candidate, index) => {
    const trainReport = searchPortfolio(data, candidate, options, { startTime: commonStart, endTime: splitTime }, masksByAsset);
    const testReport = searchPortfolio(data, candidate, options, { startTime: splitTime, endTime: endExclusive }, masksByAsset);
    const trainScore = scoreSearchResult(trainReport, config.minTrades), testScore = scoreSearchResult(testReport, config.minTrades);
    onProgress(8 + Math.round((index + 1) / generated.candidates.length * 82), `自動搜尋 ${index + 1} / ${generated.candidates.length}`);
    return {
      id: candidate.id, combination: candidate.combination, stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit,
      description: candidateDescription(candidate), train: trainReport.stats, test: testReport.stats,
      trainScore, testScore, trainAssetsPositive: trainScore.consistency, testAssetsPositive: testScore.consistency,
    };
  });
  const winners = pickSearchWinners(ranking, config.minTrades);
  const display = winners.stability ?? ranking.slice().sort((a, b) => b.train.trades - a.train.trades || b.train.totalReturn - a.train.totalReturn)[0];
  if (!display) throw new Error('沒有可用的候選策略');
  const displayCandidate = { id: display.id, combination: display.combination, stopLoss: display.stopLoss, takeProfit: display.takeProfit };
  const full = searchPortfolio(data, displayCandidate, options, { startTime: commonStart, endTime: endExclusive }, masksByAsset);
  const test = searchPortfolio(data, displayCandidate, options, { startTime: splitTime, endTime: endExclusive }, masksByAsset);
  const benchmark = (fromTime, toTime) => {
    const baseStart = data[0].candles.findIndex(c => c.time === fromTime);
    const baseEndFound = data[0].candles.findIndex(c => c.time === toTime);
    const baseEnd = baseEndFound < 0 ? data[0].candles.length : baseEndFound;
    return data[0].candles.slice(baseStart, baseEnd).map((c, i, all) => ({
      time: c.time,
      value: data.reduce((sum, d) => {
        const from = d.candles.findIndex(x => x.time === fromTime);
        const capital = options.capital / data.length, entry = d.candles[from].open * (1 + options.slippage);
        const qty = capital / (entry * (1 + options.fee));
        return sum + qty * d.candles[from + i].close * (i === all.length - 1 ? (1 - options.slippage) * (1 - options.fee) : 1);
      }, 0),
    }));
  };
  full.benchmark = benchmark(commonStart, endExclusive); test.benchmark = benchmark(splitTime, endExclusive);
  const winnerSummary = {};
  for (const [kind, row] of Object.entries(winners)) if (row) winnerSummary[kind] = { ...row, explanation: explainSearchCandidate(row, kind, config.minTrades) };
  const best = { id: 'combination-search', name: '條件組合自動搜尋', params: {}, indicators: '跨週期 AND 自動搜尋', combination: display.combination };
  const resultOptions = { ...options, combination: display.combination, stopLoss: display.stopLoss, takeProfit: display.takeProfit };
  return {
    options: resultOptions, best, full, test, folds: [], snapshot: {}, searchRanking: ranking, winners: winnerSummary,
    ranking: ranking.slice().sort((a, b) => b.trainScore.stabilityScore - a.trainScore.stabilityScore).slice(0, 50).map(r => ({
      strategy: { id: 'combination-search', name: r.description, combination: r.combination }, train: r.train, test: r.test, score: r.trainScore.stabilityScore,
    })),
    metadata: {
      mode: 'combination-search', generatedAt: new Date().toISOString(), sources: raw.map(d => ({ symbol: d.symbol, source: d.source, fetchedAt: d.fetchedAt })),
      symbols: raw.map(d => d.symbol), start: commonStart, end: commonEnd, split: splitTime,
      bars, candidates: generated.candidates.length, candidateSpace: generated.totalSpace, riskProfiles: generated.riskProfiles,
      minTrades: config.minTrades, commonPeriodTrimmed: commonStart > options.startTime + intervals['15m'],
      warnings: [
        `搜尋只用前 70% 資料選候選，最後 30% 僅作未見樣本驗證；共實測 ${generated.candidates.length} 組，理論搜尋空間約 ${generated.totalSpace.toLocaleString()} 組。`,
        `冠軍必須在訓練段至少 ${config.minTrades} 筆且無估計清算；若沒有候選達標，冠軍卡會留空。`,
        '自動搜尋固定使用 15m 作成交執行層；1h／4h／1d 條件只有原生 K 線真正收盤後才可使用。',
        '大量排列組合仍會增加過度擬合風險；樣本外結果不能再拿來反覆調參後仍稱為樣本外。',
        '目前交易對清單有倖存者偏誤，歷史獲利不保證未來。',
      ],
    },
  };
}
