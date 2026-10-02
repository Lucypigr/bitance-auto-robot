import { intervals } from './backtest.js';
export const demoAssets = [
  ['BTC', 67420, 'Bitcoin'], ['ETH', 3520, 'Ethereum'], ['SOL', 148, 'Solana'], ['BNB', 598, 'BNB'],
  ['XRP', .62, 'XRP'], ['DOGE', .14, 'Dogecoin'], ['ADA', .42, 'Cardano'], ['AVAX', 35, 'Avalanche'],
  ['LINK', 15, 'Chainlink'], ['DOT', 6.5, 'Polkadot'], ['LTC', 82, 'Litecoin'], ['SUI', 1.3, 'Sui'],
  ['NEAR', 5.2, 'NEAR'], ['APT', 8, 'Aptos'], ['UNI', 9, 'Uniswap'], ['ATOM', 7, 'Cosmos'],
];
function seedOf(symbol) { return [...symbol].reduce((a, v) => (a * 31 + v.charCodeAt(0)) >>> 0, 7); }
function noise(x) { const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }
export function demoHistory(symbol, interval, startTime, endTime, market = 'spot') {
  const step = intervals[interval], seed = seedOf(symbol) % 10000;
  const base = demoAssets.find(a => `${a[0]}USDT` === symbol)?.[1] ?? 25;
  const end = Math.min(Math.floor(Date.now() / step) * step, endTime);
  const start = Math.floor(startTime / step) * step - 220 * step;
  const origin = Date.UTC(2024, 0, 1);
  const price = time => {
    const h = (time - origin) / 3600000;
    return base * Math.exp(.000018 * h + .1 * Math.sin(h / 180 + seed) + .045 * Math.sin(h / 37 + seed / 10) + .014 * (noise(h + seed) - .5));
  };
  const candles = [], funding = [];
  for (let time = start; time < end; time += step) {
    const open = price(time), close = price(time + step);
    const spread = .001 + noise(time / step + seed) * .004 * Math.sqrt(step / 3600000);
    const high = Math.max(open, close) * (1 + spread), low = Math.min(open, close) * (1 - spread);
    const c = { time, open, high, low, close, volume: (100 + noise(time / step + seed + 50) * 1000) * 60000 / base };
    if (market === 'futures') Object.assign(c, { markOpen: open * 1.0001, markHigh: high * 1.0001, markLow: low * 1.0001, markClose: close * 1.0001 });
    candles.push(c);
    if (market === 'futures' && time % (8 * 3600000) === 0) funding.push({ time, rate: (noise(time / step + seed) - .35) * .0003, markPrice: c.markOpen });
  }
  return { symbol, quote: 'USDT', market, interval, candles, funding, source: 'synthetic', fetchedAt: new Date().toISOString() };
}
export function demoMarkets() {
  return demoAssets.map(([base, price, name], i) => ({ symbol: `${base}USDT`, base, quote: 'USDT', name, price, change: Math.sin(i * 2 + 1) * 5, volume: 1e9 / (i + 1), high: price * 1.04, low: price * .96 }));
}
