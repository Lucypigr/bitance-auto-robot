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
  for (let i = 0; i < base.length; i++) {
    const decisionTime = base[i].time + intervals[baseInterval];
    for (const [interval, frame] of Object.entries(frames)) {
      while (frame.index + 1 < frame.candles.length && frame.candles[frame.index + 1].time + intervals[interval] <= decisionTime) frame.index++;
    }
    // Require 200 completed candles in every selected timeframe, including the current close.
    ready[i] = Number(Object.values(frames).every(f => f.index >= 199));
    const matches = ready[i] && combination.conditions.every(c => {
      const f = frames[c.interval];
      const fresh = f.candles[f.index].time + intervals[c.interval] === decisionTime;
      return conditionMatches(c, f.indicators, f.index, fresh, f.candles);
    });
    if (matches) signals[i] = combination.side === 'long' ? 1 : 2;
  }
  return { signals, ready };
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
    const { signals, ready } = buildCombinationSignals(candles, timeframes, combination, options.interval);
    const from = candles.findIndex((c, i) => i >= 200 && c.time >= options.startTime && ready[i - 1]);
    if (from < 0) throw new Error(`${d.symbol} 跨週期暖機不足`);
    return { ...d, candles, indicators: computeIndicators(candles), signals, from };
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
    warnings: ['本報告為指定條件的完整期間回測，沒有自動選參數或樣本外排名。', '交叉僅在該週期交叉收盤時成立；狀態條件採最新已收盤值。', '各幣等額配置獨立帳戶；零交易、零報酬均不算正報酬。', '停損停利同根觸及時停損優先；跳空採開盤價。', '重複測試可能過度擬合；歷史獲利不保證未來。'],
  } };
}
