import { intervals, validateCandles } from './backtest.js';
const origins = { spot: 'https://data-api.binance.vision', futures: 'https://fapi.binance.com' };
const cache = new Map();
let queue = Promise.resolve(), lastRequest = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class DataError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
async function cached(key, ttl, loader) {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const value = loader();
  cache.set(key, { value, expires: Date.now() + ttl });
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  try { return await value; } catch (e) { cache.delete(key); throw e; }
}
async function request(market, path, params = {}, signal) {
  const run = queue.then(async () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已停止', 'AbortError');
    await delay(Math.max(0, 230 - (Date.now() - lastRequest)));
    if (signal?.aborted) throw signal.reason ?? new DOMException('已停止', 'AbortError');
    lastRequest = Date.now();
    const url = new URL(path, origins[market]);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Accept: 'application/json' } }); }
      catch { if (signal?.aborted) throw signal.reason ?? new DOMException('已停止', 'AbortError'); throw new DataError('無法連線幣安：請檢查網域存取、瀏覽器跨網域政策、所在地服務限制與網路連線。未自動替換成示範資料。'); }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const retry = Number(res.headers.get('retry-after') ?? 1);
        if (!Number.isFinite(retry) || retry > 10) throw new DataError('幣安要求降低請求頻率，請稍後重試', 429);
        await res.arrayBuffer(); await delay(Math.max(1, retry) * 1000 * (attempt + 1)); continue;
      }
      if (!res.ok) throw new DataError(`幣安資料請求失敗（HTTP ${res.status}）${[403, 451].includes(res.status) ? '：請檢查網路政策或所在地服務限制' : ''}`, res.status === 429 ? 429 : 502);
      let json;
      try { json = await res.json(); } catch { throw new DataError('幣安回傳非 JSON 資料'); }
      if (json && !Array.isArray(json) && json.code < 0) throw new DataError(`幣安 API 錯誤 ${json.code}`);
      return json;
    }
  });
  queue = run.catch(() => {});
  return run;
}
export async function getMarkets(market, signal) {
  return cached(`markets:${market}`, 15000, async () => {
    const prefix = market === 'spot' ? '/api/v3' : '/fapi/v1';
    const info = await cached(`exchange:${market}`, 3600000, () => request(market, `${prefix}/exchangeInfo`, {}, signal));
    const tickers = await request(market, `${prefix}/ticker/24hr`, {}, signal);
    const bySymbol = new Map(tickers.map(t => [t.symbol, t]));
    return { source: 'binance', market, fetchedAt: new Date().toISOString(), markets: info.symbols.filter(s => s.status === 'TRADING' && (market === 'spot' ? s.isSpotTradingAllowed !== false : s.contractType === 'PERPETUAL' && ['USDT', 'USDC'].includes(s.quoteAsset))).map(s => {
      const t = bySymbol.get(s.symbol) ?? {};
      return { symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset, price: Number(t.lastPrice) || 0, change: Number(t.priceChangePercent) || 0, volume: Number(t.quoteVolume) || 0, high: Number(t.highPrice) || 0, low: Number(t.lowPrice) || 0 };
    }).sort((a, b) => b.volume - a.volume) };
  });
}
export function parseHistoryQuery(params) {
  const market = params.get('market') ?? 'spot', symbol = params.get('symbol') ?? '', interval = params.get('interval') ?? '1h';
  const startTime = Number(params.get('start')), requestedEnd = Number(params.get('end'));
  if (!['spot', 'futures'].includes(market) || !/^[\p{L}\p{N}]{2,40}$/u.test(symbol) || !Object.hasOwn(intervals, interval)) throw new DataError('市場、交易對或週期不正確', 400);
  const step = intervals[interval];
  const endTime = Math.min(requestedEnd, Math.floor(Date.now() / step) * step);
  if (!params.has('start') || !params.has('end') || !Number.isSafeInteger(startTime) || !Number.isSafeInteger(requestedEnd) || startTime < Date.UTC(2017, 0, 1) || endTime <= startTime || (endTime - startTime) / step > 50000) throw new DataError('日期範圍無效：最多 50,000 根已收盤 K 線', 400);
  const signalOnly = params.get('purpose') === 'signals';
  if (signalOnly && !['15m', '1h', '4h', '1d'].includes(interval)) throw new DataError('條件週期無效', 400);
  if (market === 'futures' && step > 3600000 && !signalOnly) throw new DataError('合約支援 5m、15m、1h 週期', 400);
  return { market, symbol, interval, startTime, endTime, ...(signalOnly ? { signalOnly } : {}) };
}
async function paginatedCandles(market, path, symbol, interval, startTime, endTime, signal) {
  let cursor = startTime;
  const rows = [];
  for (let page = 0; cursor < endTime && page < 52; page++) {
    const batch = await request(market, path, { symbol, interval, startTime: cursor, endTime: endTime - 1, limit: 1000 }, signal);
    if (!Array.isArray(batch)) throw new DataError('K 線資料格式不正確');
    if (!batch.length) break;
    for (const c of batch) if (Number(c[0]) >= cursor && Number(c[0]) < endTime && Number(c[6]) < Date.now()) rows.push({ time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) });
    const next = Number(batch.at(-1)[0]) + intervals[interval];
    if (next <= cursor) throw new DataError('幣安分頁沒有前進');
    cursor = next;
  }
  if (rows.length && rows.at(-1).time + intervals[interval] < endTime) throw new DataError('歷史資料未完整覆蓋指定結束時間，請重試或縮短期間');
  validateCandles(rows, intervals[interval]);
  return rows;
}
export async function getHistory(query, signal) {
  const { market, symbol, interval, startTime, endTime, signalOnly = false } = query;
  return cached(`history:${JSON.stringify(query)}`, 120000, async () => {
    const listed = (await getMarkets(market, signal)).markets.find(m => m.symbol === symbol);
    if (!listed) throw new DataError('此交易對不在目前可交易清單', 400);
    const warmStart = Math.floor(startTime / intervals[interval]) * intervals[interval] - 220 * intervals[interval];
    const prefix = market === 'spot' ? '/api/v3' : '/fapi/v1';
    const candles = await paginatedCandles(market, `${prefix}/klines`, symbol, interval, warmStart, endTime, signal);
    if (!candles.length) throw new DataError('指定期間沒有 K 線資料', 422);
    const funding = [];
    if (market === 'futures' && !signalOnly) {
      const marks = await paginatedCandles(market, '/fapi/v1/markPriceKlines', symbol, interval, warmStart, endTime, signal);
      const byTime = new Map(marks.map(c => [c.time, c]));
      for (const c of candles) {
        const m = byTime.get(c.time);
        if (!m) throw new DataError('缺少標記價格 K 線，無法執行合約清算估算');
        Object.assign(c, { markOpen: m.open, markHigh: m.high, markLow: m.low, markClose: m.close });
      }
      let cursor = candles[0].time;
      for (let page = 0; cursor < endTime && page < 60; page++) {
        const batch = await request(market, '/fapi/v1/fundingRate', { symbol, startTime: cursor, endTime: endTime - 1, limit: 1000 }, signal);
        if (!Array.isArray(batch)) throw new DataError('資金費率格式不正確');
        if (!batch.length) break;
        for (const f of batch) {
          const event = { time: Number(f.fundingTime), rate: Number(f.fundingRate), markPrice: Number(f.markPrice) };
          if (![event.time, event.rate, event.markPrice].every(Number.isFinite) || event.markPrice <= 0) throw new DataError('資金費率缺少有效標記價格');
          funding.push(event);
        }
        const next = Number(batch.at(-1).fundingTime) + 1;
        if (next <= cursor) throw new DataError('資金費率分頁沒有前進');
        cursor = next;
      }
      if (!funding.length && endTime - candles[0].time > 86400000) throw new DataError('資金費率歷史為空，合約結果不可驗證');
    }
    return { symbol, quote: listed.quote, market, interval, candles, funding, source: 'binance', fetchedAt: new Date().toISOString() };
  });
}
