import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, intervals } from '../src/backtest.js';
import { allAssetsPositive, buildCombinationSignals, conditionMatches, executionInterval, validateCombination } from '../src/combination.js';
import { demoHistory } from '../src/demo.js';
import { parseHistoryQuery } from '../src/binance.js';
import { detectPattern, patternCatalog } from '../src/patterns.js';
const candle = (time, close = 100) => ({ time, open: close, close, high: close + 1, low: close - 1, volume: 100 });
const rawCandle = (i, open, high, low, close) => ({ time: i * intervals['1h'], open, high, low, close, volume: 100 });
test('all nine candlestick reversal patterns have deterministic positive and negative cases', () => {
  assert.equal(Object.keys(patternCatalog).length, 9);
  const down = [rawCandle(0,111,112,109,110),rawCandle(1,110,111,107,108),rawCandle(2,108,109,105,106),rawCandle(3,106,107,103,104)];
  const up = [rawCandle(0,99,101,98,100),rawCandle(1,100,103,99,102),rawCandle(2,102,105,101,104),rawCandle(3,104,107,103,106)];
  const hammer = [...down, rawCandle(4,103,104.2,99.5,104)];
  assert.equal(detectPattern(hammer,4,'hammer'),true); assert.equal(detectPattern(hammer,4,'hangingMan'),false);
  const inv = [...down, rawCandle(4,103,108,102.8,104)];
  assert.equal(detectPattern(inv,4,'invertedHammer'),true); assert.equal(detectPattern(inv,4,'shootingStar'),false);
  const hanging = [...up, rawCandle(4,106,107.2,102,107)];
  assert.equal(detectPattern(hanging,4,'hangingMan'),true); assert.equal(detectPattern(hanging,4,'hammer'),false);
  const shooting = [...up, rawCandle(4,106,111,105.8,107)];
  assert.equal(detectPattern(shooting,4,'shootingStar'),true); assert.equal(detectPattern(shooting,4,'invertedHammer'),false);
  const bullEngulf = [...down, rawCandle(4,104,104.5,101.5,102), rawCandle(5,101,105.5,100.5,105)];
  assert.equal(detectPattern(bullEngulf,5,'bullishEngulfing'),true); assert.equal(detectPattern(bullEngulf,5,'bearishEngulfing'),false);
  const bearEngulf = [...up, rawCandle(4,106,108.5,105.5,108), rawCandle(5,109,109.5,104.5,105)];
  assert.equal(detectPattern(bearEngulf,5,'bearishEngulfing'),true); assert.equal(detectPattern(bearEngulf,5,'bullishEngulfing'),false);
  const doji = [rawCandle(0,100,102,98,100.2)];
  assert.equal(detectPattern(doji,0,'doji'),true); assert.equal(detectPattern([rawCandle(0,99,102,98,101.5)],0,'doji'),false);
  const morning = [...down, rawCandle(4,104,104.5,99,100), rawCandle(5,100,101,99,100.2), rawCandle(6,100.5,104.5,100,104)];
  assert.equal(detectPattern(morning,6,'morningStar'),true); assert.equal(detectPattern(morning,6,'eveningStar'),false);
  const evening = [...up, rawCandle(4,106,111,105.5,110), rawCandle(5,110,111,109,109.8), rawCandle(6,109.5,110,105.5,106)];
  assert.equal(detectPattern(evening,6,'eveningStar'),true); assert.equal(detectPattern(evening,6,'morningStar'),false);
  assert.equal(conditionMatches({ type: 'hammer' }, {}, 4, true, hammer), true);
  assert.equal(conditionMatches({ type: 'hammer' }, {}, 4, false, hammer), false);
});

const settings = { market: 'spot', interval: '1h', capital: 10000, fee: .001, slippage: .0005, allocation: .95, stopLoss: .02, takeProfit: .04, trailingStop: 0, leverage: 1, maintenance: .005, strategy: 'combination', startTime: Date.UTC(2025, 0, 1), endTime: Date.UTC(2025, 1, 1) };
test('all eight conditions implement inclusive states and fresh native-timeframe cross events', () => {
  const d = { ema50: [1, 3], ema200: [2, 2], macd: [1, 3], macdSignal: [2, 2], rsi: [70, 30], close: [100, 100], bbUpper: [100, 100], bbLower: [100, 100] };
  for (const type of ['emaGolden', 'macdGolden']) { assert.equal(conditionMatches({ type }, d, 1, true), true); assert.equal(conditionMatches({ type }, d, 1, false), false); }
  for (const type of ['emaDeath', 'macdDeath']) assert.equal(conditionMatches({ type }, { ...d, ema50: [3, 1], macd: [3, 1] }, 1, true), true);
  assert.equal(conditionMatches({ type: 'rsiOverbought', threshold: 70 }, d, 0, false), true);
  assert.equal(conditionMatches({ type: 'rsiOversold', threshold: 30 }, d, 1, false), true);
  for (const type of ['bbUpper', 'bbLower']) assert.equal(conditionMatches({ type }, d, 1, false), true);
  assert.equal(conditionMatches({ type: 'rsiOversold', threshold: 100 }, { rsi: [null] }, 0, true), false);
});
test('4h candles are invisible to 1h decisions until the exact 4h close; future edits do not alter earlier signals', () => {
  const base = Array.from({ length: 812 }, (_, i) => candle(i * intervals['1h']));
  const higher = Array.from({ length: 204 }, (_, i) => candle(i * intervals['4h'], i < 200 ? 100 : 80));
  const combo = { side: 'long', conditions: [{ interval: '4h', type: 'rsiOversold', threshold: 30 }] };
  const original = buildCombinationSignals(base, { '4h': higher }, combo, '1h');
  assert.equal(original.signals[802], 0); // decision 803h: the bearish 800h candle is still forming
  assert.equal(original.signals[803], 1); // decision 804h: now closed
  const changed = higher.map((c, i) => i >= 200 ? candle(c.time, 150) : c);
  const revised = buildCombinationSignals(base, { '4h': changed }, combo, '1h');
  assert.deepEqual(original.signals.slice(0, 803), revised.signals.slice(0, 803));
  assert.equal(revised.signals[803], 0);
});
test('AND requires every selected timeframe and condition; native cross does not repeat after close', () => {
  const base = Array.from({ length: 1000 }, (_, i) => candle(i * intervals['1h'], i < 800 ? 100 : 80));
  const higher = Array.from({ length: 250 }, (_, i) => candle(i * intervals['4h'], i < 200 ? 100 : 80));
  const conditions = [{ interval: '4h', type: 'rsiOversold', threshold: 30 }, { interval: '1h', type: 'rsiOverbought', threshold: 70 }];
  const both = buildCombinationSignals(base, { '4h': higher, '1h': base }, { side: 'long', conditions }, '1h');
  assert.ok(both.signals.every(v => v === 0));
  const cross = buildCombinationSignals(base, { '4h': higher }, { side: 'short', conditions: [{ interval: '4h', type: 'macdDeath' }] }, '1h');
  assert.equal(cross.signals[803], 2);
  assert.equal(cross.signals[804], 0);
});
test('1d data stays invisible before UTC close even when its OHLC is supplied in advance', () => {
  const base = Array.from({ length: 202 * 96 }, (_, i) => candle(i * intervals['15m']));
  const daily = Array.from({ length: 202 }, (_, i) => candle(i * intervals['1d'], i < 200 ? 100 : 70));
  const combo = { side: 'long', conditions: [{ interval: '1d', type: 'rsiOversold', threshold: 30 }] };
  const result = buildCombinationSignals(base, { '1d': daily }, combo, '15m');
  assert.equal(result.signals[201 * 96 - 2], 0);
  assert.equal(result.signals[201 * 96 - 1], 1);
});
test('configuration validation and futures signal-only high timeframes preserve the execution restriction', () => {
  const combo = { side: 'short', conditions: [{ interval: '1d', type: 'emaDeath' }] };
  assert.equal(executionInterval(combo, 'spot'), '1d'); assert.equal(executionInterval(combo, 'futures'), '1h');
  assert.throws(() => validateCombination({ side: 'long', conditions: [] }));
  assert.throws(() => validateCombination({ ...combo, conditions: [...combo.conditions, ...combo.conditions] }));
  assert.throws(() => validateCombination({ ...combo, conditions: [{ interval: '1h', type: 'rsiOversold', threshold: NaN }] }));
  const query = new URLSearchParams({ market: 'futures', symbol: 'BTCUSDT', interval: '1d', start: settings.startTime, end: settings.endTime });
  assert.throws(() => parseHistoryQuery(query)); query.set('purpose', 'signals'); assert.equal(parseHistoryQuery(query).signalOnly, true);
});
test('all-positive requires a complete positive traded result for every selected symbol', () => {
  const positive = [{ symbol: 'A', totalReturn: 2, trades: 1 }, { symbol: 'B', totalReturn: 3, trades: 2 }];
  assert.equal(allAssetsPositive(positive, ['A', 'B']), true);
  for (const totalReturn of [0, -1, NaN]) assert.equal(allAssetsPositive([positive[0], { ...positive[1], totalReturn }], ['A', 'B']), false);
  assert.equal(allAssetsPositive([{ ...positive[0], trades: 0 }], ['A']), false);
  assert.equal(allAssetsPositive(positive.slice(0, 1), ['A', 'B']), false);
  assert.equal(allAssetsPositive([], []), false);
});
test('multi-asset long and short reports reconcile costs, trades, and next-open execution', () => {
  for (const side of ['long', 'short']) {
    const market = side === 'short' ? 'futures' : 'spot';
    const options = { ...settings, market, combination: { side, conditions: [{ interval: '1h', type: 'rsiOversold', threshold: 100 }] } };
    const raw = ['BTCUSDT', 'ETHUSDT'].map(symbol => demoHistory(symbol, '1h', options.startTime, options.endTime, market));
    const result = analyze(raw, options);
    assert.equal(result.metadata.mode, 'combination'); assert.equal(result.full.assets.length, 2);
    assert.ok(result.full.trades.length > 0);
    assert.ok(result.full.trades.every(t => t.side === side && t.entryTime >= options.startTime && t.fees > 0));
    assert.equal(result.full.trades[0].entryTime, options.startTime);
    assert.ok(Math.abs(result.full.stats.netProfit - result.full.trades.reduce((s, t) => s + t.pnl, 0)) < 1e-7);
    assert.equal(result.full.allPositive, allAssetsPositive(result.full.assets, raw.map(d => d.symbol)));
    assert.ok(result.full.assets.every(a => Number.isFinite(a.winRate) && a.maxDrawdown <= 0));
  }
});
test('missing timeframe fails explicitly; no trades yields zero return and false all-positive', () => {
  const raw = [demoHistory('BTCUSDT', '1h', settings.startTime, settings.endTime)];
  assert.throws(() => analyze(raw, { ...settings, combination: { side: 'long', conditions: [{ interval: '1h', type: 'rsiOversold', threshold: 0 }, { interval: '4h', type: 'bbLower' }] } }), /缺少/);
  const result = analyze(raw, { ...settings, combination: { side: 'long', conditions: [{ interval: '1h', type: 'rsiOversold', threshold: 0 }] } });
  assert.equal(result.full.stats.trades, 0); assert.equal(result.full.stats.totalReturn, 0); assert.equal(result.full.allPositive, false);
});
