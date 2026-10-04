export const patternCatalog = {
  hammer: '槌頭線 Hammer（偏多反轉）',
  invertedHammer: '倒槌頭 Inverted Hammer（偏多反轉）',
  hangingMan: '上吊線 Hanging Man（偏空警訊）',
  shootingStar: '流星線 Shooting Star（偏空反轉）',
  bullishEngulfing: '看漲吞噬 Bullish Engulfing',
  bearishEngulfing: '看跌吞噬 Bearish Engulfing',
  doji: '十字星 Doji（多空猶豫）',
  morningStar: '晨星 Morning Star（偏多反轉）',
  eveningStar: '暮星 Evening Star（偏空反轉）',
};
export const patternShortLabels = {
  hammer: '槌頭', invertedHammer: '倒槌', hangingMan: '上吊', shootingStar: '流星',
  bullishEngulfing: '吞↑', bearishEngulfing: '吞↓', doji: '十字', morningStar: '晨星', eveningStar: '暮星',
};
export const patternBias = {
  hammer: 'bullish', invertedHammer: 'bullish', hangingMan: 'bearish', shootingStar: 'bearish',
  bullishEngulfing: 'bullish', bearishEngulfing: 'bearish', doji: 'neutral', morningStar: 'bullish', eveningStar: 'bearish',
};
const valid = c => c && [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high > c.low;
function shape(c) {
  if (!valid(c)) return null;
  const range = c.high - c.low, body = Math.abs(c.close - c.open);
  return { range, body, upper: c.high - Math.max(c.open, c.close), lower: Math.min(c.open, c.close) - c.low, bullish: c.close > c.open, bearish: c.close < c.open };
}
function trend(candles, index, direction) {
  if (index < 4) return false;
  const prior = candles.slice(index - 4, index);
  if (prior.some(c => !valid(c))) return false;
  let up = 0, down = 0;
  for (let i = 1; i < prior.length; i++) {
    if (prior[i].close > prior[i - 1].close) up++;
    if (prior[i].close < prior[i - 1].close) down++;
  }
  const net = prior.at(-1).close - prior[0].close;
  return direction === 'up' ? net > 0 && up >= 2 : net < 0 && down >= 2;
}
function hammerShape(c) {
  const s = shape(c); if (!s) return false;
  return s.body <= s.range * .35 && s.lower >= Math.max(s.body * 2, s.range * .45) && s.upper <= s.range * .15 && Math.max(c.open, c.close) >= c.low + s.range * .65;
}
function invertedShape(c) {
  const s = shape(c); if (!s) return false;
  return s.body <= s.range * .35 && s.upper >= Math.max(s.body * 2, s.range * .45) && s.lower <= s.range * .15 && Math.min(c.open, c.close) <= c.low + s.range * .35;
}
function strongBody(c, bullish) {
  const s = shape(c); return !!s && s.body >= s.range * .5 && (bullish ? s.bullish : s.bearish);
}
export function detectPattern(candles, index, type) {
  const c = candles?.[index]; if (!valid(c)) return false;
  const s = shape(c);
  switch (type) {
    case 'doji': return s.body <= s.range * .1;
    case 'hammer': return trend(candles, index, 'down') && hammerShape(c);
    case 'hangingMan': return trend(candles, index, 'up') && hammerShape(c);
    case 'invertedHammer': return trend(candles, index, 'down') && invertedShape(c);
    case 'shootingStar': return trend(candles, index, 'up') && invertedShape(c);
    case 'bullishEngulfing': {
      const p = candles[index - 1]; if (!valid(p) || !trend(candles, index - 1, 'down')) return false;
      return p.close < p.open && c.close > c.open && c.open <= p.close && c.close >= p.open && Math.abs(c.close - c.open) > Math.abs(p.close - p.open);
    }
    case 'bearishEngulfing': {
      const p = candles[index - 1]; if (!valid(p) || !trend(candles, index - 1, 'up')) return false;
      return p.close > p.open && c.close < c.open && c.open >= p.close && c.close <= p.open && Math.abs(c.close - c.open) > Math.abs(p.close - p.open);
    }
    case 'morningStar': {
      if (index < 2) return false;
      const a = candles[index - 2], b = candles[index - 1], bs = shape(b);
      return trend(candles, index - 2, 'down') && strongBody(a, false) && !!bs && bs.body <= bs.range * .3 && strongBody(c, true) && c.close >= (a.open + a.close) / 2;
    }
    case 'eveningStar': {
      if (index < 2) return false;
      const a = candles[index - 2], b = candles[index - 1], bs = shape(b);
      return trend(candles, index - 2, 'up') && strongBody(a, true) && !!bs && bs.body <= bs.range * .3 && strongBody(c, false) && c.close <= (a.open + a.close) / 2;
    }
    default: return false;
  }
}
export function patternsAt(candles, index) {
  return Object.keys(patternCatalog).filter(type => detectPattern(candles, index, type));
}
