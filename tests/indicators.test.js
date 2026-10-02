import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, computeIndicators, indicatorCatalog } from '../src/indicators.js';
import { demoHistory } from '../src/demo.js';
test('SMA and EMA seed only after a complete window', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, null, 3, 4, 5], 3), [null, null, null, null, 4]);
});
test('Wilder RSI matches reference calculation and handles flat prices', () => {
  const prices = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  assert.ok(Math.abs(rsi(prices).at(-1) - 70.46413502109705) < 1e-8);
  assert.equal(rsi(Array(20).fill(100)).at(-1), 50);
  assert.equal(rsi(Array.from({length:20}, (_, i) => i)).at(-1), 100);
});
test('all indicator outputs are causal, warmed and finite', () => {
  const data = demoHistory('BTCUSDT', '1h', Date.UTC(2025, 0, 1), Date.UTC(2025, 0, 20)).candles;
  const full = computeIndicators(data), prefix = computeIndicators(data.slice(0, 350));
  assert.deepEqual(Object.keys(full).sort(), Object.keys(indicatorCatalog).sort());
  for (const [key, values] of Object.entries(full)) {
    assert.deepEqual(values.slice(0, 350), prefix[key], key);
    assert.ok(Number.isFinite(values.at(-1)), `${key} warmed up`);
  }
});
test('Donchian excludes current bar and UTC VWAP resets at midnight', () => {
  const candles = Array.from({length:25}, (_, i) => ({time:Date.UTC(2025,0,1)+i*3600000,open:100,high:i===20?1000:110,low:90,close:100,volume:2}));
  const v = computeIndicators(candles);
  assert.equal(v.donchianHigh[20], 110);
  assert.equal(v.donchianHigh[21], 1000);
  assert.equal(v.vwap[24], 100);
});
