import { computeIndicators } from './indicators.js';
import { candidates, signalAt } from './strategies.js';
import { analyzeCombination } from './combination.js';
export const intervals = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const DAY = 86400000;
export function validateOptions(o) {
  for (const [key, min, max] of [['capital', 5, 1e9], ['fee', 0, .02], ['slippage', 0, .02], ['allocation', .01, 1], ['stopLoss', 0, .5], ['takeProfit', 0, 2], ['trailingStop', 0, .5], ['leverage', 1, 10], ['maintenance', .001, .1]]) {
    if (!Number.isFinite(o[key]) || o[key] < min || o[key] > max) throw new Error(`${key} 必須介於 ${min} 與 ${max}`);
  }
  if (!['spot', 'futures'].includes(o.market) || !Object.hasOwn(intervals, o.interval)) throw new Error('市場或 K 線週期不正確');
  if (o.market === 'spot' && o.leverage !== 1) throw new Error('現貨只支援 1 倍、做多');
  if (o.market === 'futures' && intervals[o.interval] > 3600000) throw new Error('合約使用 5m／15m／1h，避免資金費率落在大週期 K 線內');
  if (o.leverage * (o.maintenance + o.fee) >= 1) throw new Error('槓桿與維持保證金率組合會導致立即清算');
}
export function validateCandles(candles, interval) {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) || Math.min(c.open, c.high, c.low, c.close) <= 0 || c.volume < 0 || c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close)) throw new Error(`第 ${i + 1} 根 K 線資料無效`);
    if (i && c.time - candles[i - 1].time !== interval) throw new Error('歷史 K 線有缺口或重複，請縮短期間；未以補值掩蓋缺漏');
  }
}
export function metrics(equity, trades, capital, interval) {
  let peak = capital, drawdown = 0, longestDD = 0, ddStart = null;
  const daily = new Map();
  for (const p of equity) {
    peak = Math.max(peak, p.value);
    p.drawdown = peak ? (p.value / peak - 1) * 100 : 0;
    drawdown = Math.min(drawdown, p.drawdown);
    if (p.value < peak) { if (ddStart === null) ddStart = p.time; longestDD = Math.max(longestDD, (p.time - ddStart) / DAY); } else ddStart = null;
    daily.set(new Date(p.time).toISOString().slice(0, 10), p.value);
  }
  let prior = capital;
  const returns = [...daily.values()].map(v => { const r = prior > 0 ? v / prior - 1 : 0; prior = v; return r; });
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.length > 1 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
  const downside = Math.sqrt(returns.reduce((a, r) => a + Math.min(0, r) ** 2, 0) / (returns.length || 1));
  const endValue = equity.at(-1)?.value ?? capital;
  const years = equity.length ? (equity.at(-1).time - equity[0].time + interval) / (365 * DAY) : 0;
  const cagr = years >= 30 / 365 ? (Math.pow(Math.max(0, endValue / capital), 1 / years) - 1) * 100 : null;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  let streak = 0, maxLossStreak = 0;
  for (const t of trades) { streak = t.pnl < 0 ? streak + 1 : 0; maxLossStreak = Math.max(maxLossStreak, streak); }
  const monthly = [];
  let monthStart = capital, monthKey = '';
  for (const [date, v] of daily) {
    const key = date.slice(0, 7);
    if (key !== monthKey) { monthKey = key; monthly.push({ month: key, return: 0, value: v }); }
    const m = monthly.at(-1); m.return = monthStart ? (v / monthStart - 1) * 100 : 0; m.value = v;
  }
  monthStart = capital;
  for (const m of monthly) { m.return = monthStart ? (m.value / monthStart - 1) * 100 : 0; monthStart = m.value; }
  return {
    endValue, netProfit: endValue - capital, totalReturn: (endValue / capital - 1) * 100,
    cagr: Number.isFinite(cagr) ? cagr : null, maxDrawdown: drawdown, drawdownDays: longestDD,
    sharpe: returns.length >= 7 && variance > 1e-16 ? mean / Math.sqrt(variance) * Math.sqrt(365) : null,
    sortino: returns.length >= 7 && downside > 1e-12 ? mean / downside * Math.sqrt(365) : null,
    calmar: cagr !== null && drawdown < 0 ? cagr / -drawdown : null,
    trades: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    noLosses: trades.length > 0 && grossLoss === 0,
    expectancy: trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0, avgLoss: losses.length ? -grossLoss / losses.length : 0,
    avgHoldingHours: trades.length ? trades.reduce((s, t) => s + (t.exitTime - t.entryTime) / 3600000, 0) / trades.length : 0,
    fees: trades.reduce((s, t) => s + t.fees, 0), funding: trades.reduce((s, t) => s + t.funding, 0),
    slippageCost: trades.reduce((s, t) => s + t.slippageCost, 0),
    liquidations: trades.filter(t => t.reason === 'liquidation').length,
    maxLossStreak, monthly, days: years * 365,
  };
}

// Cash is settled account equity, with open PnL marked separately (also for unlevered spot).
export function simulate(dataset, strategy, options, range, suppliedSignals) {
  const { candles, indicators = computeIndicators(candles), funding = [], symbol } = dataset;
  const { start = 200, end = candles.length } = range ?? {};
  const { capital, fee, slippage, allocation, leverage, stopLoss, takeProfit, trailingStop, maintenance, market, interval } = options;
  let cash = capital, pos = null, exposed = 0, fundingIndex = 0;
  const equity = [], trades = [];
  while (fundingIndex < funding.length && funding[fundingIndex].time < candles[start].time) fundingIndex++;
  const liqPrice = () => {
    if (!pos || market !== 'futures') return null;
    const remaining = pos.margin - pos.entryFee - pos.funding;
    return pos.direction === 1
      ? (pos.qty * pos.entry - remaining) / (pos.qty * (1 - maintenance - fee))
      : (pos.qty * pos.entry + remaining) / (pos.qty * (1 + maintenance + fee));
  };
  function closePosition(rawPrice, time, reason) {
    const p = pos;
    const exit = rawPrice * (1 - p.direction * slippage);
    const exitFee = exit * p.qty * fee;
    let realized = p.direction * p.qty * (exit - p.entry) - exitFee;
    // Conservative isolated liquidation: remaining collateral is forfeited, no extra cross-wallet loss.
    if (reason === 'liquidation') realized = -Math.max(0, p.margin - p.entryFee - p.funding);
    cash = Math.max(0, cash + realized);
    const pnl = realized - p.entryFee - p.funding;
    trades.push({ symbol, side: p.direction === 1 ? 'long' : 'short', entryTime: p.time, exitTime: time,
      entry: p.entry, exit: reason === 'liquidation' ? rawPrice : exit, qty: p.qty,
      pnl, return: pnl / p.margin * 100, fees: p.entryFee + (reason === 'liquidation' ? 0 : exitFee),
      funding: p.funding, slippageCost: p.entrySlip + (reason === 'liquidation' ? 0 : Math.abs(exit - rawPrice) * p.qty), reason });
    pos = null;
  }
  for (let i = start; i < end; i++) {
    const c = candles[i];
    // Funding belongs to the position carried into the funding timestamp. Sub-hour offset is assigned to bar open.
    while (fundingIndex < funding.length && funding[fundingIndex].time < c.time + intervals[interval]) {
      const f = funding[fundingIndex++];
      if (pos && f.time >= c.time) {
        const payment = pos.direction * pos.qty * f.markPrice * f.rate;
        cash -= payment; pos.funding += payment;
      }
    }
    const rawSignal = suppliedSignals ? suppliedSignals[i - 1] : signalAt(strategy, indicators, i - 1);
    const signal = typeof rawSignal === 'number'
      ? { long: !!(rawSignal & 1), short: !!(rawSignal & 2), exitLong: !!(rawSignal & 4), exitShort: !!(rawSignal & 8) }
      : rawSignal;
    let exited = false;
    if (pos) {
      const markOpen = c.markOpen ?? c.open;
      const lp = liqPrice();
      if (lp !== null && (pos.direction === 1 ? markOpen <= lp : markOpen >= lp)) { closePosition(markOpen, c.time, 'liquidation'); exited = true; }
      else if (pos.stop && (pos.direction === 1 ? c.open <= pos.stop : c.open >= pos.stop)) { closePosition(c.open, c.time, 'stop'); exited = true; }
      else if (pos.target && (pos.direction === 1 ? c.open >= pos.target : c.open <= pos.target)) { closePosition(c.open, c.time, 'target'); exited = true; }
      else if (pos.direction === 1 ? signal.exitLong : signal.exitShort) { closePosition(c.open, c.time, 'signal'); exited = true; }
    }
    if (!pos && !exited && cash > 1e-8) {
      const direction = signal.long && !signal.short ? 1 : market === 'futures' && signal.short && !signal.long ? -1 : 0;
      if (direction) {
        const entry = c.open * (1 + direction * slippage);
        const qty = cash * allocation * leverage / (entry * (1 + fee * leverage));
        const entryFee = qty * entry * fee;
        pos = { direction, entry, qty, time: c.time, entryFee, entrySlip: Math.abs(entry - c.open) * qty,
          margin: qty * entry / leverage, funding: 0,
          stop: stopLoss ? entry * (1 - direction * stopLoss) : null,
          target: takeProfit ? entry * (1 + direction * takeProfit) : null };
        cash -= entryFee;
      }
    }
    if (pos) {
      exposed++;
      const lp = liqPrice();
      const hitLiq = lp !== null && (pos.direction === 1 ? (c.markLow ?? c.low) <= lp : (c.markHigh ?? c.high) >= lp);
      const hitStop = pos.stop && (pos.direction === 1 ? c.low <= pos.stop : c.high >= pos.stop);
      const hitTarget = pos.target && (pos.direction === 1 ? c.high >= pos.target : c.low <= pos.target);
      // OHLC does not encode event order: liquidation first, then stop, then target.
      if (hitLiq) closePosition(lp, c.time + intervals[interval] - 1, 'liquidation');
      else if (hitStop) closePosition(pos.stop, c.time + intervals[interval] - 1, 'stop');
      else if (hitTarget) closePosition(pos.target, c.time + intervals[interval] - 1, 'target');
      else if (trailingStop) {
        // Only completed closes move the trailing stop; it becomes active on the following bar.
        const nextStop = c.close * (1 - pos.direction * trailingStop);
        pos.stop = pos.stop === null ? nextStop : pos.direction === 1 ? Math.max(pos.stop, nextStop) : Math.min(pos.stop, nextStop);
      }
    }
    if (i === end - 1 && pos) closePosition(c.close, c.time + intervals[interval] - 1, 'end');
    const marked = market === 'futures' ? (c.markClose ?? c.close) : c.close;
    equity.push({ time: c.time, value: Math.max(0, cash + (pos ? pos.direction * pos.qty * (marked - pos.entry) : 0)) });
  }
  const stats = metrics(equity, trades, capital, intervals[interval]);
  stats.exposure = exposed / (end - start) * 100;
  return { equity, trades, stats };
}
function portfolio(datasets, strategy, options, range, signalCache) {
  const parts = datasets.map((d, i) => simulate(d, strategy, { ...options, capital: options.capital / datasets.length }, range, signalCache?.[i]));
  const equity = parts[0].equity.map((p, i) => ({ time: p.time, value: parts.reduce((s, r) => s + r.equity[i].value, 0) }));
  const trades = parts.flatMap(p => p.trades).sort((a, b) => a.exitTime - b.exitTime);
  const stats = metrics(equity, trades, options.capital, intervals[options.interval]);
  stats.exposure = parts.reduce((s, p) => s + p.stats.exposure, 0) / parts.length;
  return { equity, trades, stats, assets: parts.map((p, i) => ({ symbol: datasets[i].symbol, ...p.stats })) };
}
function score(stats) {
  if (stats.trades < 3 || stats.sharpe === null || stats.liquidations) return -100000 + stats.totalReturn;
  return stats.sharpe - Math.abs(stats.maxDrawdown) / 25 + Math.min(stats.trades, 30) / 100;
}
export function analyze(raw, options, onProgress = () => {}) {
  if (options.strategy === 'combination') return analyzeCombination(raw, options, onProgress);
  validateOptions(options);
  if (!raw.length || raw.length > 15) throw new Error('每次可比較 1 至 15 個交易對');
  if (new Set(raw.map(d => d.symbol)).size !== raw.length) throw new Error('交易對不得重複');
  if (new Set(raw.map(d => d.quote)).size !== 1) throw new Error('投資組合必須使用相同報價幣');
  if (raw.reduce((sum, d) => sum + d.candles.length, 0) > 251320) throw new Error('投資組合合計最多 250,000 根研究 K 線，另加暖機');
  const step = intervals[options.interval];
  for (const d of raw) {
    validateCandles(d.candles, step);
    if (d.candles.length < 300) throw new Error(`${d.symbol} 歷史資料不足（含 200 根指標暖機）`);
    if (options.market === 'futures' && (!Array.isArray(d.funding) || !d.candles.every(c => [c.markOpen, c.markHigh, c.markLow, c.markClose].every(v => Number.isFinite(v) && v > 0)))) throw new Error('合約回測需要完整標記價格與資金費率資料');
    if (options.market === 'futures') {
      for (let i = 0; i < d.funding.length; i++) {
        const f = d.funding[i];
        if (![f.time, f.rate, f.markPrice].every(Number.isFinite) || f.markPrice <= 0 || (i && f.time <= d.funding[i - 1].time)) throw new Error('資金費率事件必須有效且按時間嚴格遞增');
      }
      for (const c of d.candles) if (c.markHigh < Math.max(c.markOpen, c.markClose) || c.markLow > Math.min(c.markOpen, c.markClose)) throw new Error('標記價格 OHLC 不一致');
    }
  }
  const commonStart = Math.max(...raw.map(d => d.candles[0].time));
  const commonEnd = Math.min(...raw.map(d => d.candles.at(-1).time));
  const data = raw.map(d => {
    const candles = d.candles.filter(c => c.time >= commonStart && c.time <= commonEnd);
    return { ...d, candles, indicators: computeIndicators(candles) };
  });
  const firstRequested = data[0].candles.findIndex(c => c.time >= options.startTime);
  const start = Math.max(200, firstRequested < 0 ? data[0].candles.length : firstRequested);
  const end = data[0].candles.length;
  if (end - start < 100) throw new Error('共同有效期間不足 100 根 K 線，請增加日期範圍或移除新上市交易對');
  const split = start + Math.floor((end - start) * .7);
  const choices = candidates(options.strategy, options.optimize, options.customRules);
  const caches = new Map();
  const run = (s, range) => portfolio(data, s, options, range, caches.get(s.id));
  const ranking = choices.map((strategy, index) => {
    // Four booleans per candle fit in one byte, keeping large multi-asset searches bounded.
    caches.set(strategy.id, data.map(d => Uint8Array.from(d.candles, (_, i) => {
      const s = signalAt(strategy, d.indicators, i);
      return Number(s.long) | (Number(s.short) << 1) | (Number(s.exitLong) << 2) | (Number(s.exitShort) << 3);
    })));
    const train = run(strategy, { start, end: split });
    const test = run(strategy, { start: split, end });
    onProgress(Math.round((index + 1) / choices.length * 70), `比較策略 ${index + 1} / ${choices.length}`);
    return { strategy, train: train.stats, test: test.stats, score: score(train.stats) };
  }).sort((a, b) => b.score - a.score);
  const best = ranking[0].strategy;
  const full = run(best, { start, end }), test = run(best, { start: split, end });
  const folds = [];
  const trainSize = Math.floor((end - start) * .5), testSize = Math.floor((end - start - trainSize) / 3);
  for (let fold = 0; fold < 3; fold++) {
    const trainEnd = start + trainSize + fold * testSize;
    const foldEnd = fold === 2 ? end : trainEnd + testSize;
    const winner = choices.map(s => ({ s, stats: run(s, { start: trainEnd - trainSize, end: trainEnd }).stats })).sort((a, b) => score(b.stats) - score(a.stats))[0];
    const evaluated = run(winner.s, { start: trainEnd, end: foldEnd });
    folds.push({ strategy: winner.s.name, start: data[0].candles[trainEnd].time, end: data[0].candles[foldEnd - 1].time, train: winner.stats, test: evaluated.stats });
    onProgress(75 + fold * 10, `滾動驗證 ${fold + 1} / 3`);
  }
  // Unleveraged spot-like buy-and-hold price benchmark, including the same fee/slippage; no funding.
  function benchmark(from, to) {
    return data[0].candles.slice(from, to).map((c, i, all) => {
      const value = data.reduce((total, d) => {
        const capital = options.capital / data.length;
        const entry = d.candles[from].open * (1 + options.slippage);
        const qty = capital / (entry * (1 + options.fee));
        const last = i === all.length - 1;
        return total + qty * d.candles[from + i].close * (last ? (1 - options.slippage) * (1 - options.fee) : 1);
      }, 0);
      return { time: c.time, value };
    });
  }
  full.benchmark = benchmark(start, end); test.benchmark = benchmark(split, end);
  const last = data[0].candles.length - 1;
  return { options, best, ranking, full, test, folds,
    metadata: { generatedAt: new Date().toISOString(), sources: raw.map(d => ({ symbol: d.symbol, source: d.source, fetchedAt: d.fetchedAt })),
      start: data[0].candles[start].time, end: data[0].candles[end - 1].time, split: data[0].candles[split].time,
      bars: end - start, warmup: start, candidates: choices.length, symbols: data.map(d => d.symbol),
      commonPeriodTrimmed: data[0].candles[start].time > options.startTime + step,
      warnings: ['現存交易對清單存在倖存者偏誤；未含已下架交易對。', '固定滑價未模擬委託簿、成交量限制、最小下單量與稅費。', '多幣種採等額獨立帳戶，無再平衡；不是共用保證金。', ...(options.market === 'futures' ? ['清算採可調固定維持保證金率與逐倉模型，非幣安分級強平引擎。', '清算、停損、停利同根觸及時採清算優先、停損次之的保守次序。', '資金費率按該根開盤前持倉計算，毫秒級時間差歸入該根開盤。'] : ['同根同時觸及停損停利，採停損優先。']), '指標與策略反覆挑選會增加過度擬合；樣本外結果不可再次用來挑參數。'] },
    snapshot: Object.fromEntries(Object.entries(data[0].indicators).map(([k, v]) => [k, v[last]])),
  };
}
