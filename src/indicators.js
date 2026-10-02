// Every output at index i uses only candles 0..i. null means insufficient history.
export function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) { sum += values[i]; count++; }
    if (i >= period && Number.isFinite(values[i - period])) { sum -= values[i - period]; count--; }
    if (i >= period - 1 && count === period) out[i] = sum / period;
  }
  return out;
}
export function ema(values, period, alpha = 2 / (period + 1)) {
  const out = Array(values.length).fill(null);
  let seed = [], previous = null;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) { seed = []; previous = null; continue; }
    if (previous === null) {
      seed.push(values[i]);
      if (seed.length === period) previous = seed.reduce((a, b) => a + b, 0) / period;
    } else previous += alpha * (values[i] - previous);
    out[i] = previous;
  }
  return out;
}
export function rsi(values, period = 14) {
  const changes = values.map((v, i) => i ? v - values[i - 1] : null);
  const up = ema(changes.map(v => v === null ? null : Math.max(0, v)), period, 1 / period);
  const down = ema(changes.map(v => v === null ? null : Math.max(0, -v)), period, 1 / period);
  return up.map((v, i) => v === null ? null : down[i] === 0 ? (v === 0 ? 50 : 100) : 100 - 100 / (1 + v / down[i]));
}
function extreme(values, period, fn) {
  return values.map((_, i) => i < period - 1 ? null : fn(...values.slice(i - period + 1, i + 1)));
}
export const indicatorCatalog = {
  close: '收盤價', sma20: 'SMA 20', sma50: 'SMA 50', sma200: 'SMA 200',
  ema12: 'EMA 12', ema26: 'EMA 26', ema50: 'EMA 50', ema200: 'EMA 200',
  rsi: 'RSI 14', macd: 'MACD 12/26', macdSignal: 'MACD Signal 9', macdHist: 'MACD Histogram',
  bbUpper: '布林上軌 20/2', bbMiddle: '布林中軌 20', bbLower: '布林下軌 20/2', bbWidth: '布林帶寬 %',
  atr: 'ATR 14', adx: 'ADX 14', plusDI: '+DI 14', minusDI: '−DI 14',
  stochK: 'Stochastic %K 14', stochD: 'Stochastic %D 3', cci: 'CCI 20',
  williamsR: 'Williams %R 14', roc: 'ROC 12 %', obv: 'OBV', obvMA: 'OBV SMA 20',
  vwap: 'UTC 日內 VWAP', mfi: 'MFI 14', volume: '成交量', volumeMA: '成交量 SMA 20',
  donchianHigh: '前 20 根 Donchian 上軌', donchianLow: '前 20 根 Donchian 下軌',
  keltnerUpper: 'Keltner 上軌 20/2', keltnerLower: 'Keltner 下軌 20/2',
  supertrend: 'Supertrend 10/3', supertrendDirection: 'Supertrend 方向 ±1',
};
export function computeIndicators(candles) {
  const close = candles.map(c => c.close), high = candles.map(c => c.high), low = candles.map(c => c.low);
  const volume = candles.map(c => c.volume), typical = candles.map(c => (c.high + c.low + c.close) / 3);
  const tr = candles.map((c, i) => i ? Math.max(c.high - c.low, Math.abs(c.high - close[i - 1]), Math.abs(c.low - close[i - 1])) : c.high - c.low);
  const atr = ema(tr, 14, 1 / 14);
  const result = { close, volume, atr, rsi: rsi(close), volumeMA: sma(volume, 20) };
  for (const p of [20, 50, 200]) result[`sma${p}`] = sma(close, p);
  for (const p of [12, 26, 50, 200]) result[`ema${p}`] = ema(close, p);
  result.macd = close.map((_, i) => result.ema26[i] === null ? null : result.ema12[i] - result.ema26[i]);
  result.macdSignal = ema(result.macd, 9);
  result.macdHist = result.macd.map((v, i) => result.macdSignal[i] === null ? null : v - result.macdSignal[i]);
  result.bbMiddle = result.sma20;
  const deviation = close.map((_, i) => i < 19 ? null : Math.sqrt(close.slice(i - 19, i + 1).reduce((a, v) => a + (v - result.sma20[i]) ** 2, 0) / 20));
  result.bbUpper = deviation.map((v, i) => v === null ? null : result.sma20[i] + v * 2);
  result.bbLower = deviation.map((v, i) => v === null ? null : result.sma20[i] - v * 2);
  result.bbWidth = deviation.map((v, i) => v === null ? null : v * 4 / result.sma20[i] * 100);
  const hh = extreme(high, 14, Math.max), ll = extreme(low, 14, Math.min);
  result.stochK = close.map((v, i) => hh[i] === null ? null : hh[i] === ll[i] ? 50 : 100 * (v - ll[i]) / (hh[i] - ll[i]));
  result.stochD = sma(result.stochK, 3);
  result.williamsR = result.stochK.map(v => v === null ? null : v - 100);
  const meanTP = sma(typical, 20);
  result.cci = typical.map((v, i) => {
    if (meanTP[i] === null) return null;
    const md = typical.slice(i - 19, i + 1).reduce((a, n) => a + Math.abs(n - meanTP[i]), 0) / 20;
    return md === 0 ? 0 : (v - meanTP[i]) / (.015 * md);
  });
  result.roc = close.map((v, i) => i < 12 ? null : (v / close[i - 12] - 1) * 100);
  let obv = 0, pv = 0, vol = 0, day = '';
  result.obv = close.map((v, i) => { if (i) obv += Math.sign(v - close[i - 1]) * volume[i]; return obv; });
  result.obvMA = sma(result.obv, 20);
  result.vwap = candles.map((c, i) => {
    const currentDay = new Date(c.time).toISOString().slice(0, 10);
    if (currentDay !== day) { day = currentDay; pv = 0; vol = 0; }
    pv += typical[i] * c.volume; vol += c.volume;
    return vol ? pv / vol : typical[i];
  });
  const upFlow = typical.map((v, i) => i && v > typical[i - 1] ? v * volume[i] : 0);
  const downFlow = typical.map((v, i) => i && v < typical[i - 1] ? v * volume[i] : 0);
  const moneyUp = sma(upFlow, 14), moneyDown = sma(downFlow, 14);
  result.mfi = moneyUp.map((v, i) => v === null ? null : moneyDown[i] === 0 ? (v === 0 ? 50 : 100) : 100 - 100 / (1 + v / moneyDown[i]));
  const plus = candles.map((c, i) => {
    if (!i) return 0;
    const u = c.high - high[i - 1], d = low[i - 1] - c.low;
    return u > d && u > 0 ? u : 0;
  });
  const minus = candles.map((c, i) => {
    if (!i) return 0;
    const u = c.high - high[i - 1], d = low[i - 1] - c.low;
    return d > u && d > 0 ? d : 0;
  });
  result.plusDI = ema(plus, 14, 1 / 14).map((v, i) => v === null ? null : atr[i] ? 100 * v / atr[i] : 0);
  result.minusDI = ema(minus, 14, 1 / 14).map((v, i) => v === null ? null : atr[i] ? 100 * v / atr[i] : 0);
  result.adx = ema(result.plusDI.map((v, i) => v === null ? null : v + result.minusDI[i] === 0 ? 0 : 100 * Math.abs(v - result.minusDI[i]) / (v + result.minusDI[i])), 14, 1 / 14);
  const dcH = extreme(high, 20, Math.max), dcL = extreme(low, 20, Math.min);
  result.donchianHigh = close.map((_, i) => i ? dcH[i - 1] : null);
  result.donchianLow = close.map((_, i) => i ? dcL[i - 1] : null);
  const ema20 = ema(close, 20);
  result.keltnerUpper = ema20.map((v, i) => v === null || atr[i] === null ? null : v + 2 * atr[i]);
  result.keltnerLower = ema20.map((v, i) => v === null || atr[i] === null ? null : v - 2 * atr[i]);
  const atr10 = ema(tr, 10, .1);
  result.supertrend = Array(close.length).fill(null);
  result.supertrendDirection = Array(close.length).fill(null);
  let upper = null, lower = null, direction = 1;
  for (let i = 0; i < close.length; i++) {
    if (atr10[i] === null) continue;
    const bu = (high[i] + low[i]) / 2 + 3 * atr10[i], bl = (high[i] + low[i]) / 2 - 3 * atr10[i];
    upper = upper === null || bu < upper || close[i - 1] > upper ? bu : upper;
    lower = lower === null || bl > lower || close[i - 1] < lower ? bl : lower;
    if (direction === -1 && close[i] > upper) direction = 1;
    else if (direction === 1 && close[i] < lower) direction = -1;
    result.supertrend[i] = direction === 1 ? lower : upper;
    result.supertrendDirection[i] = direction;
  }
  return result;
}
