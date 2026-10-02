import { indicatorCatalog } from './indicators.js';
export const strategyCatalog = [
  { id: 'trend', name: '趨勢共振', indicators: 'EMA · MACD · ADX', description: '快慢均線與 MACD 同向，ADX 過濾弱趨勢。', params: { adx: 20 } },
  { id: 'rsi', name: 'RSI 均值回歸', indicators: 'RSI', description: 'RSI 超賣進場、回到中軸出場；合約亦可做空超買。', params: { low: 30, high: 70 } },
  { id: 'bollinger', name: '布林反轉', indicators: 'Bollinger · RSI', description: '價格突破布林外軌且動能極端，回到中軌平倉。', params: { low: 35, high: 65 } },
  { id: 'donchian', name: '通道突破', indicators: 'Donchian · Volume', description: '突破前 20 根通道，成交量確認，跌破 EMA 26 出場。', params: { volume: 1.1 } },
  { id: 'macd', name: 'MACD 動能', indicators: 'MACD · EMA 200', description: 'MACD 黃金／死亡交叉，搭配 EMA 200 趨勢方向。', params: {} },
  { id: 'stochastic', name: '隨機指標反轉', indicators: 'Stochastic · RSI', description: '低檔 K/D 黃金交叉進場，高檔反向做空。', params: { low: 25, high: 75 } },
  { id: 'supertrend', name: '超級趨勢', indicators: 'Supertrend · ADX', description: 'ATR 追蹤趨勢方向，ADX 過濾盤整。', params: { adx: 20 } },
  { id: 'keltner', name: '波動突破', indicators: 'Keltner · MACD', description: '突破 ATR 通道且 MACD 同方向。', params: {} },
  { id: 'vwap', name: '量價確認', indicators: 'VWAP · OBV · RSI', description: 'UTC 日內 VWAP 交叉，OBV 與 RSI 確認量價。', params: {} },
  { id: 'cci', name: '資金流反轉', indicators: 'CCI · MFI', description: 'CCI 和 MFI 同時進入極端區間，回到 CCI 中軸出場。', params: { threshold: 100 } },
];
export function validateRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error('自訂策略必須是規則物件');
  for (const key of ['entryLong', 'exitLong', 'entryShort', 'exitShort']) {
    if (!Array.isArray(rules[key]) || rules[key].length > 8) throw new Error(`${key} 必須是最多 8 條規則的陣列`);
    for (const rule of rules[key]) {
      if (!rule || !Object.hasOwn(indicatorCatalog, rule.left) || !['>', '<', 'crossAbove', 'crossBelow'].includes(rule.op)) throw new Error(`${key} 指標或運算子無效`);
      if (!(typeof rule.right === 'number' && Number.isFinite(rule.right)) && !Object.hasOwn(indicatorCatalog, rule.right)) throw new Error(`${key} 比較值無效`);
    }
  }
  if (!rules.entryLong.length && !rules.entryShort.length) throw new Error('至少設定一組進場規則');
  return rules;
}
export function signalAt(strategy, data, i) {
  const value = (key, offset = 0) => typeof key === 'number' ? key : data[key]?.[i + offset];
  const valid = (...keys) => keys.every(k => Number.isFinite(value(k)));
  const gt = (a, b) => valid(a, b) && value(a) > value(b);
  const lt = (a, b) => valid(a, b) && value(a) < value(b);
  const crossUp = (a, b) => gt(a, b) && Number.isFinite(value(a, -1)) && Number.isFinite(value(b, -1)) && value(a, -1) <= value(b, -1);
  const crossDown = (a, b) => lt(a, b) && Number.isFinite(value(a, -1)) && Number.isFinite(value(b, -1)) && value(a, -1) >= value(b, -1);
  const p = strategy.params;
  let long = false, short = false, exitLong = false, exitShort = false;
  switch (strategy.id.split(':')[0]) {
    case 'trend':
      long = gt('ema12', 'ema26') && gt('macdHist', 0) && gt('adx', p.adx);
      short = lt('ema12', 'ema26') && lt('macdHist', 0) && gt('adx', p.adx);
      exitLong = lt('ema12', 'ema26') || lt('macdHist', 0); exitShort = gt('ema12', 'ema26') || gt('macdHist', 0); break;
    case 'rsi':
      long = lt('rsi', p.low); short = gt('rsi', p.high); exitLong = gt('rsi', 50); exitShort = lt('rsi', 50); break;
    case 'bollinger':
      long = lt('close', 'bbLower') && lt('rsi', p.low); short = gt('close', 'bbUpper') && gt('rsi', p.high);
      exitLong = gt('close', 'bbMiddle'); exitShort = lt('close', 'bbMiddle'); break;
    case 'donchian':
      long = gt('close', 'donchianHigh') && valid('volumeMA') && gt('volume', value('volumeMA') * p.volume);
      short = lt('close', 'donchianLow') && valid('volumeMA') && gt('volume', value('volumeMA') * p.volume);
      exitLong = lt('close', 'ema26'); exitShort = gt('close', 'ema26'); break;
    case 'macd':
      long = crossUp('macd', 'macdSignal') && gt('close', 'ema200'); short = crossDown('macd', 'macdSignal') && lt('close', 'ema200');
      exitLong = crossDown('macd', 'macdSignal'); exitShort = crossUp('macd', 'macdSignal'); break;
    case 'stochastic':
      long = crossUp('stochK', 'stochD') && lt('stochK', p.low) && lt('rsi', 50);
      short = crossDown('stochK', 'stochD') && gt('stochK', p.high) && gt('rsi', 50);
      exitLong = gt('stochK', 75); exitShort = lt('stochK', 25); break;
    case 'supertrend':
      long = gt('supertrendDirection', 0) && gt('adx', p.adx); short = lt('supertrendDirection', 0) && gt('adx', p.adx);
      exitLong = lt('supertrendDirection', 0); exitShort = gt('supertrendDirection', 0); break;
    case 'keltner':
      long = gt('close', 'keltnerUpper') && gt('macdHist', 0); short = lt('close', 'keltnerLower') && lt('macdHist', 0);
      exitLong = lt('close', 'ema26'); exitShort = gt('close', 'ema26'); break;
    case 'vwap':
      long = crossUp('close', 'vwap') && gt('obv', 'obvMA') && gt('rsi', 50);
      short = crossDown('close', 'vwap') && lt('obv', 'obvMA') && lt('rsi', 50);
      exitLong = lt('close', 'vwap'); exitShort = gt('close', 'vwap'); break;
    case 'cci':
      long = lt('cci', -p.threshold) && lt('mfi', 25); short = gt('cci', p.threshold) && gt('mfi', 75);
      exitLong = gt('cci', 0); exitShort = lt('cci', 0); break;
    case 'custom': {
      const compare = { '>': gt, '<': lt, crossAbove: crossUp, crossBelow: crossDown };
      const match = list => list.length > 0 && list.every(r => compare[r.op](r.left, r.right));
      long = match(strategy.rules.entryLong); short = match(strategy.rules.entryShort);
      exitLong = match(strategy.rules.exitLong); exitShort = match(strategy.rules.exitShort); break;
    }
    default: throw new Error('未知策略');
  }
  return { long, short, exitLong, exitShort };
}
export function candidates(selected, optimize, customRules) {
  if (selected === 'custom') return [{ id: 'custom', name: '我的自訂策略', indicators: '自訂規則', params: {}, rules: validateRules(customRules) }];
  const base = selected === 'auto' ? strategyCatalog : strategyCatalog.filter(s => s.id === selected);
  if (!base.length) throw new Error('未知策略');
  return base.flatMap(s => {
    const original = { ...s, params: { ...s.params } };
    if (!optimize) return [original];
    const variants = s.id === 'trend' || s.id === 'supertrend' ? [{ adx: 15 }, { adx: 30 }]
      : s.id === 'rsi' ? [{ low: 25, high: 75 }, { low: 35, high: 65 }]
      : s.id === 'bollinger' ? [{ low: 30, high: 70 }, { low: 40, high: 60 }]
      : s.id === 'donchian' ? [{ volume: .8 }, { volume: 1.5 }]
      : s.id === 'stochastic' ? [{ low: 20, high: 80 }, { low: 35, high: 65 }]
      : s.id === 'cci' ? [{ threshold: 150 }, { threshold: 200 }] : [];
    return [original, ...variants.map((params, i) => ({ ...s, id: `${s.id}:${i}`, name: `${s.name} · ${i + 2}`, params }))];
  });
}
