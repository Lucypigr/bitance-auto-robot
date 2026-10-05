import { strategyCatalog } from './src/strategies.js';
import { indicatorCatalog } from './src/indicators.js';
import { intervals, validateOptions } from './src/backtest.js';
import { conditionCatalog, combinationIntervals, executionInterval, validateCombination, buildCombinationSignals } from './src/combination.js';
import { detectPattern, patternCatalog, patternShortLabels, patternBias } from './src/patterns.js';
import { equityChart, drawdownChart, candlestickChart } from './charts.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const staticMode = document.querySelector('meta[name="quantlab-mode"]')?.content === 'static';
const staticData = staticMode ? await Promise.all([import('./src/binance.js'), import('./src/demo.js')]) : null;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v, digits = 2) => v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
const pct = v => `${v > 0 ? '+' : ''}${num(v)}%`;
const color = v => v > 0 ? 'positive' : v < 0 ? 'negative' : '';
const date = time => new Date(time).toISOString().slice(0, 10);
const datetime = time => new Date(time).toISOString().slice(0, 16).replace('T', ' ');
const compact = v => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
const price = v => num(v, v < 1 ? 6 : v < 100 ? 3 : 2);
const MAX_SYMBOLS = 15;
const beginnerGlossary = {
  "backtest": {
    "title": "回測",
    "text": "把一套固定買賣規則放回過去的歷史行情重跑，看看當時可能得到什麼結果；它不是未來保證。"
  },
  "kline": {
    "title": "K 線",
    "text": "把一段時間內的開盤、最高、最低、收盤價格畫成一根圖形。15m 是每 15 分鐘一根。"
  },
  "spot": {
    "title": "現貨",
    "text": "直接買進資產本身，通常只能靠價格上漲獲利；本平台現貨固定 1×、只做多。"
  },
  "futures": {
    "title": "永續合約",
    "text": "不是直接持有幣，而是用合約押注價格方向；可做多、做空，也會有槓桿、資金費率與清算風險。"
  },
  "pair": {
    "title": "交易對",
    "text": "例如 BTCUSDT 表示用 USDT 來計價 BTC。左邊是資產，右邊是報價幣。"
  },
  "capital": {
    "title": "投入資金",
    "text": "這次回測假設一開始有多少資金。多幣種回測會把總資金等額分配到各幣的獨立帳戶。"
  },
  "long": {
    "title": "做多",
    "text": "先買進或建立多單，期待價格上漲後獲利。價格下跌時通常會虧損。"
  },
  "short": {
    "title": "做空",
    "text": "建立空單，期待價格下跌後獲利。價格上漲時通常會虧損；本平台只在永續合約使用。"
  },
  "and": {
    "title": "AND 條件",
    "text": "代表「全部都要成立」。例如 RSI 超買 AND MACD 死亡交叉，兩個都符合才產生訊號。"
  },
  "signal": {
    "title": "交易訊號",
    "text": "策略條件成立的提示。這不等於立刻成交；本平台通常在訊號收盤確認後，下一根 K 線開盤成交。"
  },
  "entry": {
    "title": "進場",
    "text": "真正建立一筆部位的時點與價格。回測會計入手續費與滑價。"
  },
  "exit": {
    "title": "出場",
    "text": "把持有的部位關掉，實現這筆交易的盈虧。可能因停損、停利、訊號、期末或清算離場。"
  },
  "candidate": {
    "title": "候選策略",
    "text": "自動搜尋時被拿來比較的一組完整設定，例如條件、停損停利與槓桿。"
  },
  "training": {
    "title": "訓練段 / 前 70%",
    "text": "只用來挑選策略與參數的前段歷史資料。冠軍只能根據這一段決定。"
  },
  "holdout": {
    "title": "樣本外 / 最後 30%",
    "text": "完全不參與挑選策略的保留資料，只在選完冠軍後拿來驗證，較能看出是否過度擬合。"
  },
  "walkForward": {
    "title": "滾動驗證",
    "text": "把時間往前切成多段，每一段先用前面的資料選策略，再用後面的未見資料測試。"
  },
  "overfit": {
    "title": "過度擬合",
    "text": "策略太貼合某段歷史資料，當時看起來很好，但換一段時間或市場就失效。"
  },
  "stopLoss": {
    "title": "停損",
    "text": "虧損達到設定幅度時自動離場，用來限制單筆損失；跳空時成交可能比設定價更差。"
  },
  "takeProfit": {
    "title": "停利",
    "text": "獲利達到設定幅度時自動離場，把浮動獲利轉成已實現獲利。"
  },
  "trailingStop": {
    "title": "移動停損",
    "text": "價格往有利方向走時，停損線跟著移動，用來保護已累積的獲利。"
  },
  "leverage": {
    "title": "槓桿",
    "text": "用較少保證金控制較大的名目部位。5× 代表約 1 元保證金控制 5 元部位；盈虧、成本與清算風險都會放大。"
  },
  "margin": {
    "title": "保證金",
    "text": "合約交易中拿來承擔部位風險的資金。若剩餘保證金不足，可能觸發清算。"
  },
  "maintenance": {
    "title": "維持保證金率",
    "text": "合約部位至少要保留的安全資金比例。越接近門檻，越接近被強制清算。"
  },
  "liquidation": {
    "title": "估計清算",
    "text": "當虧損使保證金不足時，模型視為部位被強制關閉。本平台是研究估算，不是 Binance 強平引擎 1:1 複製。"
  },
  "fee": {
    "title": "手續費",
    "text": "每次成交收取的費用。進場與出場都可能收費，槓桿越高、名目部位越大，費用也可能更高。"
  },
  "slippage": {
    "title": "滑價 / 模擬成交落差",
    "text": "理想價格與實際成交價格的差距。回測用固定不利方向模擬，真實市場會隨流動性改變。"
  },
  "allocation": {
    "title": "每次用多少資金",
    "text": "每次開倉拿帳戶中多少比例的資金去建立部位。比例越高，單筆交易對總資金影響越大。"
  },
  "funding": {
    "title": "資金費率",
    "text": "永續合約多空雙方定期互相支付的費用。正費率通常由多方支付給空方，方向與金額會影響淨報酬。"
  },
  "markPrice": {
    "title": "標記價格",
    "text": "交易所用來計算未實現盈虧與強平風險的參考價格，目的是降低單一成交價異常造成的影響。"
  },
  "equity": {
    "title": "淨值",
    "text": "帳戶目前總價值，包含現金與尚未平倉部位的浮動盈虧。"
  },
  "benchmark": {
    "title": "買入持有基準",
    "text": "單純一開始買進並持有到結束的比較基準，用來判斷策略是否真的比不操作更好。"
  },
  "netReturn": {
    "title": "淨報酬",
    "text": "把交易損益扣除模型中的成本後，相對起始資金的總報酬百分比。"
  },
  "netProfit": {
    "title": "淨利",
    "text": "期末淨值減掉起始資金後的金額，已反映模型計入的交易成本。"
  },
  "winRate": {
    "title": "勝率",
    "text": "獲利交易筆數 ÷ 全部已完成交易筆數。高勝率不代表一定賺錢，還要看平均賺多少、平均賠多少。"
  },
  "maxDrawdown": {
    "title": "最大回撤",
    "text": "資金從某個高點跌到之後最低點的最大跌幅。越接近 0 通常越穩，數字越負代表曾經跌得越深。"
  },
  "cagr": {
    "title": "CAGR 年化報酬",
    "text": "把整段報酬換算成平均每年複利成長率。期間太短時參考價值很低，所以本平台不足 30 天不計。"
  },
  "sharpe": {
    "title": "Sharpe 比率",
    "text": "用報酬相對整體波動來衡量風險調整後表現。通常越高越好，但樣本少時不可靠。"
  },
  "sortino": {
    "title": "Sortino 比率",
    "text": "類似 Sharpe，但只把向下虧損波動當成主要風險，因此更聚焦在壞波動。"
  },
  "calmar": {
    "title": "Calmar 比率",
    "text": "年化報酬 ÷ 最大回撤，用來衡量「承受多深跌幅換到多少年化報酬」。"
  },
  "profitFactor": {
    "title": "Profit Factor / 獲利因子",
    "text": "所有獲利交易總額 ÷ 所有虧損交易總額。大於 1 代表總賺的金額大於總賠的金額。"
  },
  "expectancy": {
    "title": "每筆期望值",
    "text": "平均每做一筆交易，長期統計上可能賺或賠多少金額。正值較好，但需要足夠交易筆數。"
  },
  "avgWin": {
    "title": "平均盈利",
    "text": "所有獲利交易的平均獲利金額。"
  },
  "avgLoss": {
    "title": "平均虧損",
    "text": "所有虧損交易的平均虧損金額。"
  },
  "lossStreak": {
    "title": "最長連敗",
    "text": "歷史上最多連續幾筆交易都是虧損，用來估計心理與資金壓力。"
  },
  "exposure": {
    "title": "市場曝險時間",
    "text": "回測期間有持倉的時間比例。越高代表資金越常暴露在市場波動中。"
  },
  "holding": {
    "title": "平均持倉時間",
    "text": "每筆交易從進場到出場平均持續多久。"
  },
  "marginReturn": {
    "title": "保證金報酬",
    "text": "這筆合約交易的淨損益相對於投入保證金的百分比；槓桿會讓它比標的價格變動更大。"
  },
  "pnl": {
    "title": "淨損益",
    "text": "一筆交易最後實際賺或賠的金額，已依模型扣除相關費用與資金費率。"
  },
  "monthlyReturn": {
    "title": "月度報酬",
    "text": "每個 UTC 月份的資金變化百分比，可用來看策略是否只靠少數月份撐起績效。"
  },
  "positiveMonths": {
    "title": "正報酬月份",
    "text": "回測月份中有多少比例是賺錢的。比例高代表績效在時間上較平均，但仍不能保證未來。"
  },
  "crossAsset": {
    "title": "跨幣正報酬",
    "text": "選定的幣種中，有多少比例在該策略下是正報酬，用來看策略是否只靠單一幣種撐成績。"
  },
  "rsi": {
    "title": "RSI",
    "text": "0～100 的動能指標，常用來觀察短期是否偏熱或偏冷。高 RSI 不代表一定會跌，低 RSI 也不代表一定會漲。"
  },
  "ema": {
    "title": "EMA 指數移動平均",
    "text": "近期價格權重較高的平均線。EMA50 與 EMA200 的交叉常用來描述中長期趨勢變化。"
  },
  "macd": {
    "title": "MACD",
    "text": "利用兩條指數移動平均的差異觀察趨勢與動能；上穿訊號線稱黃金交叉，下穿稱死亡交叉。"
  },
  "bollinger": {
    "title": "布林通道",
    "text": "以移動平均線加上波動範圍形成上、下軌，用來觀察價格是否偏離近期常態區間。"
  },
  "adx": {
    "title": "ADX",
    "text": "衡量趨勢強度的指標，不直接告訴你漲或跌；數值高通常表示趨勢較明顯。"
  },
  "stochastic": {
    "title": "Stochastic / KD",
    "text": "比較目前收盤價在近期高低區間的位置，常用來觀察短期過熱、過冷與交叉。"
  },
  "supertrend": {
    "title": "Supertrend",
    "text": "用價格與 ATR 波動度估算趨勢方向的指標，通常顯示目前偏多或偏空。"
  },
  "keltner": {
    "title": "Keltner 通道",
    "text": "以 EMA 為中線、ATR 為寬度的波動通道，常用來觀察趨勢突破。"
  },
  "vwap": {
    "title": "VWAP",
    "text": "成交量加權平均價，可理解成當日市場的平均成交成本附近位置。"
  },
  "obv": {
    "title": "OBV",
    "text": "用成交量累積方向觀察買賣力量是否跟價格同方向。"
  },
  "cci": {
    "title": "CCI",
    "text": "衡量價格偏離其統計平均程度的動能指標，常用來觀察過熱或過冷。"
  },
  "mfi": {
    "title": "MFI",
    "text": "把價格與成交量一起考慮的 0～100 動能指標，概念上像加入成交量的 RSI。"
  },
  "donchian": {
    "title": "Donchian 通道",
    "text": "用最近一段時間最高價與最低價形成區間，常用來判斷突破。"
  },
  "atr": {
    "title": "ATR",
    "text": "衡量近期價格平均波動幅度的指標，只看波動大小，不看方向。"
  },
  "volume": {
    "title": "成交量",
    "text": "一段時間內成交的數量，用來觀察市場參與度與流動性。"
  },
  "candlestickPattern": {
    "title": "K 線反轉型態",
    "text": "用一根或數根 K 線的形狀描述可能的買賣力量變化，只是訊號條件，不代表一定反轉。"
  },
  "hammer": {
    "title": "槌頭線",
    "text": "常見於下跌後，下影線較長、實體較小，表示盤中曾大跌但買盤把價格拉回；仍需其他條件確認。"
  },
  "invertedHammer": {
    "title": "倒槌頭",
    "text": "常見於下跌後，上影線較長、實體較小，表示曾出現向上買盤嘗試，但不保證反轉。"
  },
  "hangingMan": {
    "title": "上吊線",
    "text": "常見於上漲後，形狀像槌頭線但位置不同，可能表示下方賣壓開始增加。"
  },
  "shootingStar": {
    "title": "流星線",
    "text": "常見於上漲後，上影線較長、收盤回落，可能表示高位賣壓出現。"
  },
  "bullishEngulfing": {
    "title": "看漲吞噬",
    "text": "後一根上漲 K 線的實體包住前一根下跌 K 線實體，常被視為買方力量轉強。"
  },
  "bearishEngulfing": {
    "title": "看跌吞噬",
    "text": "後一根下跌 K 線的實體包住前一根上漲 K 線實體，常被視為賣方力量轉強。"
  },
  "doji": {
    "title": "十字星",
    "text": "開盤與收盤很接近，代表多空力量暫時拉鋸，本身不等於反轉。"
  },
  "morningStar": {
    "title": "晨星",
    "text": "三根 K 線組合，常用來描述下跌後可能由空方轉向多方。"
  },
  "eveningStar": {
    "title": "暮星",
    "text": "三根 K 線組合，常用來描述上漲後可能由多方轉向空方。"
  }
};
const beginnerGlossaryRules = [
  ['profitFactor', /Profit Factor|獲利因子/], ['sortino', /Sortino/], ['calmar', /Calmar/], ['sharpe', /Sharpe/], ['cagr', /CAGR|年化報酬/],
  ['maxDrawdown', /最大回撤|最慘跌幅|回撤 DRAWDOWN|回撤/], ['winRate', /勝率/], ['netReturn', /淨報酬|測試報酬|前段報酬/], ['netProfit', /淨利/],
  ['expectancy', /每筆期望值/], ['avgWin', /平均盈利/], ['avgLoss', /平均虧損/], ['lossStreak', /最長連敗/], ['exposure', /市場曝險/], ['holding', /平均持倉/],
  ['marginReturn', /保證金報酬/], ['pnl', /淨損益/], ['funding', /資金費率/], ['liquidation', /清算/], ['maintenance', /維持保證金/], ['leverage', /槓桿/],
  ['slippage', /滑價|成交落差/], ['fee', /手續費/], ['allocation', /每次用多少資金|投入比例/], ['trailingStop', /移動停損/], ['stopLoss', /停損/], ['takeProfit', /停利/],
  ['holdout', /樣本外|最後 30%|後段測試/], ['training', /訓練段|前 70%|前段/], ['walkForward', /滾動驗證|FOLD/], ['candidate', /候選/], ['overfit', /過度擬合/],
  ['crossAsset', /跨幣正報酬|跨幣一致性/], ['positiveMonths', /正報酬月份/], ['monthlyReturn', /月度報酬/], ['benchmark', /買入持有|基準/], ['equity', /淨值|資金變化圖/],
  ['long', /做多/], ['short', /做空/], ['futures', /永續合約/], ['spot', /現貨|SPOT/], ['pair', /交易對/], ['capital', /假設投入|投入資金/], ['and', /AND/], ['signal', /訊號/],
  ['rsi', /RSI/], ['ema', /EMA/], ['macd', /MACD/], ['bollinger', /布林/], ['adx', /ADX/], ['stochastic', /Stochastic|KD/], ['supertrend', /Supertrend/],
  ['keltner', /Keltner/], ['vwap', /VWAP/], ['obv', /OBV/], ['cci', /CCI/], ['mfi', /MFI/], ['donchian', /Donchian/], ['atr', /ATR/], ['volume', /成交量/],
  ['hammer', /槌頭線/], ['invertedHammer', /倒槌頭/], ['hangingMan', /上吊線/], ['shootingStar', /流星線/], ['bullishEngulfing', /看漲吞噬/], ['bearishEngulfing', /看跌吞噬/],
  ['doji', /十字星/], ['morningStar', /晨星/], ['eveningStar', /暮星/], ['candlestickPattern', /K 線反轉型態|K 線型態/], ['kline', /K 線/], ['backtest', /回測/]
];
function termHelpButton(key) {
  const item = beginnerGlossary[key];
  return item ? '<button type="button" class="term-help" data-term-help="' + key + '" title="' + esc(item.text) + '" aria-label="解釋：' + esc(item.title) + '">ⓘ</button>' : '';
}
function decorateBeginnerTerms(root = document) {
  const selector = 'label, th, h3, h4, .field-label, .stat-label, .search-metrics>span, .chart-legend>span, .detail-tabs button, .indicator-tag, .strategy-card .indicator-label, .fold-stats span, .candle-toggle-row label';
  const nodes = [];
  if (root instanceof Element && root.matches(selector)) nodes.push(root);
  if (root.querySelectorAll) nodes.push(...root.querySelectorAll(selector));
  for (const summary of root.querySelectorAll ? root.querySelectorAll('summary') : []) {
    const text = summary.textContent.replace(/\s+/g, ' ').trim();
    const match = beginnerGlossaryRules.find(([, re]) => re.test(text));
    if (match && !summary.title) summary.title = beginnerGlossary[match[0]].text;
  }
  for (const el of nodes) {
    if (el.closest('#term-help-dialog') || el.querySelector(':scope > .term-help')) continue;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const match = beginnerGlossaryRules.find(([, re]) => re.test(text));
    if (!match) continue;
    el.insertAdjacentHTML('beforeend', termHelpButton(match[0]));
  }
}
function showTermHelp(key) {
  const item = beginnerGlossary[key], dialog = $('#term-help-dialog');
  if (!item || !dialog) return;
  $('#term-help-title').textContent = item.title;
  $('#term-help-text').textContent = item.text;
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
}
function installBeginnerHelp() {
  if (!$('#term-help-dialog')) document.body.insertAdjacentHTML('beforeend', '<dialog id="term-help-dialog" class="term-help-dialog"><div class="term-help-head"><div><span>新手名詞解釋</span><h3 id="term-help-title"></h3></div><button type="button" id="close-term-help" aria-label="關閉名詞解釋">×</button></div><p id="term-help-text"></p><small>這是回測介面的白話說明，不代表投資建議。</small></dialog>');
  decorateBeginnerTerms(document);
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorateBeginnerTerms(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
const state = { source: 'demo', market: 'spot', symbols: ['BTCUSDT'], markets: [], result: null, range: 'test', tab: 'stats', running: false, marketPage: 0, tradePage: 0, tradeSide: '', view: 'workbench', worker: null, ws: null, generation: 0, quote: 'USDT', pickingMovers: false, candleSymbol: null, candleOffset: 0, candleWindow: 120, searchSort: 'stabilityScore' };
const beginnerStrategyGuide = {
  trend: { name: '順著強勢趨勢走', intro: '只在方向很明顯時跟著趨勢進場。' },
  rsi: { name: '超跌後等反彈', intro: '價格短線跌太多時買進，恢復正常後離場。' },
  bollinger: { name: '跌出正常範圍後反彈', intro: '價格掉到近期波動範圍外，再配合超跌訊號進場。' },
  donchian: { name: '突破近期高點就跟進', intro: '價格真的突破近期區間，而且成交量放大才追進。' },
  macd: { name: '動能轉強才買', intro: '等上漲動能出現，並確認大方向仍向上才進場。' },
  stochastic: { name: '短線超跌反彈', intro: '短線跌到偏低位置，出現轉強交叉後進場。' },
  supertrend: { name: '趨勢翻多就跟進', intro: '趨勢指標轉為上漲且力量足夠時進場。' },
  keltner: { name: '價格衝出波動區間就跟進', intro: '價格突破平常波動範圍，且動能同方向時進場。' },
  vwap: { name: '價格與成交量一起轉強', intro: '價格站回平均成交成本上方，成交量方向也轉強才進場。' },
  cci: { name: '市場過冷後等反彈', intro: '兩個過熱／過冷指標同時極端時，等待反轉。' },
  custom: { name: '我的自訂規則', intro: '使用你自己設定的進場與出場條件。' }
};
function beginnerStrategy(strategy) {
  if (strategy?.id === 'combination' || strategy?.id === 'combination-search') return { name: strategy.id === 'combination-search' ? '條件組合自動搜尋' : '條件組合回測', technical: strategy.id === 'combination-search' ? '跨週期 AND 自動搜尋' : '跨週期 AND', indicators: '只用已收盤 K 線', rule: strategy.combination.conditions.map(c => `${c.interval} ${conditionCatalog[c.type]}${c.type.startsWith('rsi') ? ` ${c.threshold}` : ''}`).join(' ＋ ') + `，全部符合才${strategy.combination.side === 'long' ? '做多' : '做空'}；停損、停利或期末平倉。` };
  const key = strategy?.id?.split(':')[0] ?? 'custom';
  const p = strategy?.params ?? {};
  const base = beginnerStrategyGuide[key] ?? beginnerStrategyGuide.custom;
  const rule = {
    trend: `短期均線在長期均線上方、MACD 動能向上，而且趨勢強度 ADX > ${p.adx ?? 20} 時買進；均線或動能轉弱就賣出。`,
    rsi: `RSI < ${p.low ?? 30} 時視為短線超跌並買進；RSI 回到 50 以上賣出。合約模式下 RSI > ${p.high ?? 70} 時可做空。`,
    bollinger: `價格跌破布林通道下緣，而且 RSI < ${p.low ?? 35} 時買進；價格回到通道中線時賣出。`,
    donchian: `價格突破最近 20 根 K 線高點，而且成交量高於平均的 ${num((p.volume ?? 1.1) * 100, 0)}% 時買進；跌回 EMA26 下方就離場。`,
    macd: 'MACD 由弱轉強出現黃金交叉，而且價格在 EMA200 上方時買進；MACD 反向交叉時賣出。',
    stochastic: `KD 在低檔交叉向上、K < ${p.low ?? 25} 且 RSI < 50 時買進；K > 75 時離場。`,
    supertrend: `Supertrend 顯示上漲，而且 ADX > ${p.adx ?? 20} 時買進；Supertrend 翻成下跌就賣出。`,
    keltner: '價格突破 Keltner 通道上緣，而且 MACD 動能為正時買進；跌回 EMA26 下方就離場。',
    vwap: '價格由下往上站上當日 VWAP，同時 OBV 與 RSI 都轉強時買進；跌回 VWAP 下方就離場。',
    cci: `CCI < -${p.threshold ?? 100} 且 MFI < 25 時買進；CCI 回到 0 以上時賣出。`,
    custom: '依照你在「自訂規則」中設定的條件進出場。'
  }[key] ?? base.intro;
  return { ...base, rule, technical: strategy?.name ?? '自訂策略', indicators: strategy?.indicators ?? '自訂規則' };
}
let toastTimer, pollTimer, reconnectTimer, websocketTime = 0, marketPaint = 0;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
function notice(message = '') { $('#notice').textContent = message; $('#notice').classList.toggle('hidden', !message); }
function view(name) {
  state.view = name;
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${name}`));
  $$('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#breadcrumb-title').textContent = { workbench: '開始回測', tutorial: '新手回測教學', markets: '幣種行情', strategies: '策略說明', method: '進階說明' }[name];
  $('#page-title').innerHTML = name === 'tutorial' ? '從第一次回測開始<span>.</span>' : '三步看懂一個交易策略<span>.</span>';
  $('#page-description').textContent = name === 'tutorial' ? '跟著範例操作：把買賣想法寫成條件，跑一次，再看懂數字的意思。' : '選幣種、選交易方法、按開始。結果會直接告訴你：怎麼買、怎麼賣、賺賠多少、最慘跌多少。';
  if (name === 'markets') renderMarkets();
  history.replaceState(null, '', `#${name}`);
}
function markDirty() {
  if (state.result) $('#report-state').textContent = `${state.result.metadata.sources[0].source === 'synthetic' ? '示範' : '幣安'}結果 · 設定已變更，請重新回測`;
  if (state.result?.metadata.mode === 'combination' && $('#all-positive')) { $('#all-positive').textContent = '設定已變更，請重新回測；下表為上次結果'; $('#all-positive').className = 'combo-verdict amber'; }
}
function renderSymbols() {
  $('#selected-symbols').innerHTML = state.symbols.map(s => `<span class="symbol-chip">${esc(s)}<button type="button" data-remove-symbol="${esc(s)}" aria-label="移除 ${esc(s)}">×</button></span>`).join('');
  document.querySelectorAll('.quote-label').forEach(el => { el.textContent = state.quote; });
  if ($('#symbol-picker-count')) $('#symbol-picker-count').textContent = `已選 ${state.symbols.length} / ${MAX_SYMBOLS}`;
  if ($('#symbol-picker-count-modal')) $('#symbol-picker-count-modal').textContent = `已選 ${state.symbols.length} / ${MAX_SYMBOLS}`;
  renderSymbolCheckboxes();
}
function renderSymbolCheckboxes() {
  const container = $('#symbol-checkboxes');
  if (!container) return;
  const query = ($('#symbol-picker-search')?.value ?? '').trim().toUpperCase();
  const list = state.markets.filter(m => (query ? m.symbol.includes(query) || m.base.includes(query) : m.quote === state.quote));
  container.innerHTML = list.slice(0, 120).map(m => `<label class="symbol-picker-row"><input type="checkbox" data-check-symbol="${esc(m.symbol)}" aria-label="勾選 ${esc(m.symbol)}" ${state.symbols.includes(m.symbol) ? 'checked' : ''} ${state.running ? 'disabled' : ''}><span><strong>${esc(m.base)}</strong><small>/ ${esc(m.quote)}</small></span><em class="${color(m.change)}">${pct(m.change)}</em></label>`).join('') || '<span class="form-hint">沒有符合搜尋的幣種</span>';
}
function addSymbol(symbol) {
  if (state.running) return;
  const match = state.markets.find(m => m.symbol === symbol);
  if (!match) return toast('請先載入行情並選擇清單中的交易對');
  if (state.symbols.includes(symbol)) return;
  if (state.symbols.length >= MAX_SYMBOLS) return toast(`每次最多 ${MAX_SYMBOLS} 組交易對`);
  if (state.symbols.length && match.quote !== state.quote) return toast('投資組合需使用相同報價幣；請先移除既有交易對');
  state.quote = match.quote; state.symbols.push(symbol); renderSymbols(); markDirty();
}
async function applyFuturesMoverPreset(kind) {
  if (state.running || state.pickingMovers) return;
  const presets = {
    gainers10: { count: 10, direction: 'up', label: '24h 漲幅前 10' },
    gainers15: { count: 15, direction: 'up', label: '24h 漲幅前 15' },
    losers10: { count: 10, direction: 'down', label: '24h 跌幅前 10' },
    losers15: { count: 15, direction: 'down', label: '24h 跌幅前 15' }
  };
  const preset = presets[kind];
  if (!preset) return;
  state.pickingMovers = true;
  try {
    notice('正在取得 Binance USDT 永續合約 24 小時漲跌幅排行…');
    $('#source').value = 'live';
    await switchMarket('futures');
    const ranked = state.markets.filter(m => m.quote === 'USDT' && Number.isFinite(m.change) && m.price > 0)
      .sort((a, b) => preset.direction === 'up' ? b.change - a.change : a.change - b.change)
      .slice(0, preset.count);
    if (ranked.length < preset.count) throw new Error(`目前只取得 ${ranked.length} 個可用的 USDT 永續合約，無法選滿 ${preset.count} 個`);
    state.quote = 'USDT';
    state.symbols = ranked.map(m => m.symbol);
    $('#symbol-search').value = '';
    if ($('#symbol-picker-search')) $('#symbol-picker-search').value = '';
    renderSymbols(); markDirty(); notice();
    const dialog = $('#symbol-picker-dialog'); if (dialog?.open) dialog.close();
    toast(`已選取 Binance 合約${preset.label}`);
  } catch (e) {
    notice(e.message || '無法取得 Binance 合約漲跌幅排行');
  } finally { state.pickingMovers = false; }
}
function renderTickers() {
  const preferred = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].map(s => state.markets.find(m => m.symbol === s)).filter(Boolean);
  $('#market-strip').innerHTML = preferred.length ? preferred.map(m => `<div class="ticker"><span class="coin ${esc(m.base.toLowerCase())}">${({ BTC: '₿', ETH: 'Ξ', SOL: '◎', BNB: '◇' })[m.base] ?? esc(m.base[0])}</span><div><div class="ticker-name">${esc(m.base)}<small>/ ${esc(m.quote)}</small></div><div class="ticker-price">${price(m.price)}</div></div><div class="ticker-change ${color(m.change)}"><span>${m.change >= 0 ? '↗' : '↘'} ${pct(m.change)}</span></div></div>`).join('') : '<div class="empty-state">等待行情資料；示範模式可離線驗證平台功能。</div>';
}
function renderMarkets() {
  const query = $('#market-search').value.trim().toUpperCase(), quote = $('#quote-filter').value;
  const list = state.markets.filter(m => (!query || m.symbol.includes(query)) && (!quote || m.quote === quote));
  const size = 40, pages = Math.max(1, Math.ceil(list.length / size)); state.marketPage = Math.min(state.marketPage, pages - 1);
  $('#market-count').textContent = `${state.source === 'demo' ? '合成示範' : 'Binance'} · ${state.market === 'spot' ? '現貨' : 'USDⓈ-M 永續合約'} · ${list.length} 個交易對${state.source === 'demo' ? '（示範清單）' : ''}`;
  $('#markets-body').innerHTML = list.slice(state.marketPage * size, (state.marketPage + 1) * size).map(m => `<tr><td><strong>${esc(m.base)}</strong> <span class="muted">/ ${esc(m.quote)}</span></td><td class="mono">${price(m.price)}</td><td class="mono ${color(m.change)}">${pct(m.change)}</td><td class="mono">${price(m.high)}</td><td class="mono">${price(m.low)}</td><td class="mono">${compact(m.volume)}</td><td><button class="add-market" data-add-symbol="${esc(m.symbol)}">＋ 加入回測</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">沒有符合條件的交易對</td></tr>';
  $('#market-pagination').innerHTML = `<span>${state.marketPage + 1} / ${pages}</span><button data-market-page="-1" ${state.marketPage === 0 ? 'disabled' : ''}>←</button><button data-market-page="1" ${state.marketPage >= pages - 1 ? 'disabled' : ''}>→</button>`;
}
function setBadge(text, type = '') { $('#connection-badge').className = `status-badge ${type}`; $('#connection-badge').innerHTML = `<i></i>${esc(text)}`; }
function setSourceBanner() {
  const demo = state.source === 'demo';
  $('#data-banner').classList.toggle('connected', !demo);
  $('#data-banner').innerHTML = demo ? '<span>◉</span><div><strong>目前使用可重現的合成示範資料</strong><span>非幣安實際行情，績效僅用於操作與模型驗證。</span></div><button id="connect-live">連接幣安行情 →</button>' : '<span>◉</span><div><strong>幣安公開市場資料</strong><span>WebSocket 即時報價；連線中斷時每 15 秒更新。歷史回測只採已收盤 K 線。</span></div><button id="use-demo">使用示範資料</button>';
}
async function refreshMarkets(quiet = false) {
  const generation = ++state.generation;
  const source = state.source, market = state.market;
  try {
    let data;
    if (staticMode) data = source === 'demo'
      ? { markets: staticData[1].demoMarkets(), source: 'synthetic', market, fetchedAt: new Date().toISOString() }
      : await staticData[0].getMarkets(market);
    else {
      const response = await fetch(`/api/markets?market=${market}&demo=${source === 'demo' ? 1 : 0}`);
      data = await response.json(); if (!response.ok) throw new Error(data.error);
    }
    if (generation !== state.generation) return;
    state.markets = data.markets;
    $('#symbol-options').innerHTML = state.markets.map(m => `<option value="${esc(m.symbol)}">${esc(m.base)} / ${esc(m.quote)}</option>`).join('');
    const prior = $('#quote-filter').value;
    $('#quote-filter').innerHTML = '<option value="">全部報價幣</option>' + [...new Set(state.markets.map(m => m.quote))].sort().map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('');
    $('#quote-filter').value = [...$('#quote-filter').options].some(o => o.value === prior) ? prior : '';
    renderTickers(); renderMarkets(); renderSymbolCheckboxes();
    if (source === 'demo') setBadge('示範資料', 'demo');
    else { setBadge(state.ws?.readyState === EventSource.OPEN && Date.now() - websocketTime < 30000 ? '即時串流連線中' : 'REST 行情 · 15 秒'); if (!state.ws) connectWebSocket(); }
    if (!quiet) notice();
  } catch (e) {
    if (generation !== state.generation) return;
    setBadge('行情連線失敗', 'error');
    if (!quiet) notice(e.message || '無法載入行情');
  }
}
function connectWebSocket() {
  if (state.source !== 'live') return;
  const ws = staticMode
    ? new WebSocket(state.market === 'spot' ? 'wss://data-stream.binance.vision/ws/!miniTicker@arr' : 'wss://fstream.binance.com/ws/!miniTicker@arr')
    : new EventSource(`/api/stream?market=${state.market}`);
  state.ws = ws;
  ws.onmessage = event => {
    if (state.ws !== ws) return;
    try {
      const rows = JSON.parse(event.data); if (!Array.isArray(rows)) return;
      const updates = new Map(rows.map(r => [r.s, r]));
      for (const m of state.markets) { const r = updates.get(m.symbol); if (r) { m.price = Number(r.c); m.high = Number(r.h); m.low = Number(r.l); m.volume = Number(r.q); m.change = Number(r.o) ? (Number(r.c) / Number(r.o) - 1) * 100 : 0; } }
      websocketTime = Date.now(); setBadge('即時串流連線中');
      if (Date.now() - marketPaint > 1000) { renderTickers(); if (state.view === 'markets') renderMarkets(); marketPaint = Date.now(); }
    } catch { /* Ignore invalid external stream frames; REST remains available. */ }
  };
  if (!staticMode) ws.addEventListener('status', event => {
    try { if (JSON.parse(event.data).state === 'fallback') { websocketTime = 0; setBadge('REST 行情 · 15 秒'); } } catch {}
  });
  ws.onerror = () => {
    if (state.ws !== ws) return;
    state.ws = null; websocketTime = 0; ws.close(); setBadge('REST 行情 · 15 秒');
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectWebSocket, 15000);
  };
  if (staticMode) ws.onclose = ws.onerror;
}
async function sourceChanged() {
  if (state.ws) { const old = state.ws; state.ws = null; old.close(); }
  clearTimeout(reconnectTimer); clearInterval(pollTimer);
  state.source = $('#source').value; state.markets = []; renderTickers(); renderMarkets(); setSourceBanner(); markDirty();
  setBadge(state.source === 'demo' ? '示範資料' : '正在連接幣安…', state.source === 'demo' ? 'demo' : '');
  await refreshMarkets();
  if (state.source === 'live') pollTimer = setInterval(() => { if (!document.hidden) refreshMarkets(true); }, 15000);
}
async function switchMarket(market) {
  if (state.running) return;
  state.market = market;
  $$('[data-market]').forEach(b => b.classList.toggle('active', b.dataset.market === market));
  $('#futures-fields').classList.toggle('hidden', market !== 'futures');
  $('#search-leverage-controls')?.classList.toggle('hidden', market !== 'futures');
  [...$('#interval').options].forEach(o => { o.disabled = market === 'futures' && intervals[o.value] > 3600000; });
  if (market === 'futures' && intervals[$('#interval').value] > 3600000) $('#interval').value = '1h';
  $('#fee').value = market === 'futures' ? '.04' : '.10';
  updateCombinationDescription();
  await sourceChanged();
}
const ruleOptions = Object.entries(indicatorCatalog).map(([key, name]) => `<option value="${key}">${esc(name)}</option>`).join('');
function ruleRow(rule = { left: 'rsi', op: '<', right: 30 }) {
  const row = document.createElement('div'); row.className = 'rule-row';
  row.innerHTML = `<select aria-label="技術指標" class="rule-left">${ruleOptions}</select><select aria-label="比較方式" class="rule-op"><option value=">">大於</option><option value="<">小於</option><option value="crossAbove">上穿</option><option value="crossBelow">下穿</option></select><input aria-label="比較數字或指標" class="rule-right" list="indicator-keys"><button type="button" class="remove-rule" aria-label="移除規則">×</button>`;
  row.querySelector('.rule-left').value = rule.left; row.querySelector('.rule-op').value = rule.op; row.querySelector('.rule-right').value = rule.right;
  return row;
}
function initRules(saved) {
  const defaults = { entryLong: [{ left: 'rsi', op: '<', right: 30 }], exitLong: [{ left: 'rsi', op: '>', right: 55 }], entryShort: [{ left: 'rsi', op: '>', right: 70 }], exitShort: [{ left: 'rsi', op: '<', right: 45 }] };
  const labels = { entryLong: '做多進場', exitLong: '做多出場', entryShort: '做空進場（合約）', exitShort: '做空出場（合約）' };
  $('#rule-groups').innerHTML = Object.entries(labels).map(([key, label]) => `<div class="rule-group" data-group="${key}"><h4>${label}</h4><div class="rules-list"></div><button type="button" class="add-rule">＋ 加入條件</button></div>`).join('') + `<datalist id="indicator-keys">${Object.entries(indicatorCatalog).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</datalist>`;
  for (const [key, list] of Object.entries(saved ?? defaults)) for (const rule of list) $(`[data-group="${key}"] .rules-list`).append(ruleRow(rule));
}
function readRules() {
  return Object.fromEntries($$('.rule-group').map(group => [group.dataset.group, [...group.querySelectorAll('.rule-row')].map(row => {
    const raw = row.querySelector('.rule-right').value.trim();
    return { left: row.querySelector('.rule-left').value, op: row.querySelector('.rule-op').value, right: raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw };
  })]));
}
function readCombination() {
  return { side: $('#combination-side').value, conditions: $$('[data-combo-type]:checked').map(el => ({ interval: el.dataset.comboInterval, type: el.dataset.comboType, ...(el.dataset.comboType.startsWith('rsi') ? { threshold: Number($(el.dataset.comboType === 'rsiOverbought' ? '#combo-overbought' : '#combo-oversold').value) } : {}) })) };
}
function initCombination(saved) {
  const technical = Object.entries(conditionCatalog).filter(([type]) => !Object.hasOwn(patternCatalog, type));
  const patterns = Object.entries(patternCatalog);
  const checks = (items, interval) => items.map(([type, label]) => `<label class="checkbox-label"><input type="checkbox" data-combo-interval="${interval}" data-combo-type="${type}" aria-label="${interval} ${esc(label)}" ${(saved ? saved.conditions.some(c => c.interval === interval && c.type === type) : interval === '4h' && type === 'rsiOversold') ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('');
  $('#combination-conditions').innerHTML = combinationIntervals.map(interval => `<fieldset class="combo-timeframe"><legend>${interval} ${ { '15m': '15 分鐘', '1h': '1 小時', '4h': '4 小時', '1d': '日線' }[interval]}</legend><div class="combo-condition-title">技術指標</div>${checks(technical, interval)}<details class="pattern-conditions"><summary>K 線反轉型態（9 種）</summary><p>型態以固定 OHLC 比例與前段趨勢判定；只在該根 K 線收盤後成立。</p>${checks(patterns, interval)}</details></fieldset>`).join('');
  if (saved) $('#combination-side').value = saved.side;
  updateCombinationDescription();
}
function updateCombinationDescription() {
  const combination = readCombination();
  $('#combination-description').textContent = combination.conditions.length ? `已勾選 ${combination.conditions.length} 個 AND 條件。成交檢查週期：${executionInterval(combination, state.market)}。交叉只在發生那根收盤時成立。` : '請至少勾選一個條件。';
}
function strategyChanged() {
  const id = $('#strategy').value, structured = id === 'combination' || id === 'combination-search';
  $('#custom-builder').classList.toggle('hidden', id !== 'custom');
  $('#combination-builder').classList.toggle('hidden', id !== 'combination');
  $('#combination-search-builder')?.classList.toggle('hidden', id !== 'combination-search');
  $('#interval').disabled = structured;
  $('#optimize-row')?.classList.toggle('hidden', structured);
  document.querySelectorAll('.standard-risk-only').forEach(el => el.classList.toggle('hidden', structured));
  $('#combo-advanced-note')?.classList.toggle('hidden', !structured);
  if (id === 'combination') { $('#strategy-hint').textContent = '依你勾選的條件測整段期間，不自動選策略。每個幣種都會列出淨報酬、勝率、交易次數、最大回撤。'; updateCombinationDescription(); markDirty(); return; }
  if (id === 'combination-search') { $('#strategy-hint').textContent = '系統會用前 70% 資料搜尋合理的跨週期 AND 組合，再用最後 30% 未見資料驗證，分別找出勝率最高、最穩定與獲利最多。'; markDirty(); return; }
  if (id === 'auto') $('#strategy-hint').textContent = '最適合第一次使用：系統會把所有方法都跑一次，再把結果並排給你看。';
  else if (id === 'custom') $('#strategy-hint').textContent = '你可以自己設定買進與賣出條件；第一次使用可先跳過。';
  else { const s = strategyCatalog.find(s => s.id === id); const plain = beginnerStrategy(s); $('#strategy-hint').textContent = `${plain.intro} 具體規則：${plain.rule}`; }
  markDirty();
}
function readOptions() {
  const o = { market: state.market, interval: $('#interval').value, capital: Number($('#capital').value), strategy: $('#strategy').value,
    optimize: $('#optimize').checked, leverage: state.market === 'spot' ? 1 : Number($('#leverage').value), maintenance: Number($('#maintenance').value) / 100,
    startTime: Date.parse($('#start-date').value + 'T00:00:00Z'), endTime: Date.parse($('#end-date').value + 'T00:00:00Z'), customRules: readRules() };
  for (const key of ['fee', 'slippage', 'allocation', 'stopLoss', 'takeProfit', 'trailingStop']) o[key] = Number($(`#${key}`).value) / 100;
  if (o.strategy === 'combination') {
    o.combination = readCombination(); validateCombination(o.combination);
    o.interval = executionInterval(o.combination, o.market); o.optimize = false;
    o.stopLoss = Number($('#combo-stop').value) / 100; o.takeProfit = Number($('#combo-target').value) / 100; o.trailingStop = 0;
    if (o.market === 'spot' && o.combination.side === 'short') throw new Error('做空請先切換至「永續合約」');
    if (!(o.stopLoss > 0) || !(o.takeProfit > 0)) throw new Error('條件組合回測的停損與停利必須大於 0');
  } else if (o.strategy === 'combination-search') {
    o.interval = '15m'; o.optimize = false; o.trailingStop = 0;
    o.leverage = o.market === 'spot' ? 1 : Number($('#search-leverage').value);
    o.stopLoss = Number($('#search-stop').value) / 100; o.takeProfit = Number($('#search-target').value) / 100;
    o.search = {
      side: $('#search-side').value,
      maxConditions: Number($('#search-max-conditions').value),
      maxCandidates: Number($('#search-max-candidates').value),
      minTrades: Number($('#search-min-trades').value),
      riskSearch: $('#search-risk').checked,
      leverageSearch: o.market === 'futures' && $('#search-leverage-search').checked,
      leverage: o.leverage,
    };
    if (o.market === 'spot' && o.search.side === 'short') throw new Error('現貨自動搜尋不能只找做空，請改成「自動」或「只找做多」');
    if (!(o.stopLoss > 0) || !(o.takeProfit > 0)) throw new Error('自動搜尋的固定停損與停利必須大於 0');
  }
  validateOptions(o);
  if (!state.symbols.length) throw new Error('請至少選擇一個交易對');
  if ((o.endTime - o.startTime) / intervals[o.interval] * state.symbols.length > 250000) throw new Error('投資組合合計最多 250,000 根 K 線，請縮短期間或減少交易對');
  if (!Number.isFinite(o.startTime) || !Number.isFinite(o.endTime) || o.startTime >= o.endTime || (o.endTime - o.startTime) / intervals[o.interval] > 50000) throw new Error('日期範圍無效，最多可回測 50,000 根 K 線');
  return o;
}
function busy(active) {
  state.running = active; document.body.classList.toggle('busy', active);
  $$('#config-form input, #config-form select, #config-form button').forEach(el => { el.disabled = active; });
  $('#cancel-button').disabled = false; $('#cancel-button').classList.toggle('hidden', !active);
  $('#run-button').innerHTML = active ? '<span>◌</span> 正在用歷史資料模擬買賣… <span>↗</span>' : '<span>▷</span> 開始回測 <span>↗</span>';
  if (!active) $('#interval').disabled = ['combination', 'combination-search'].includes($('#strategy').value);
}
function progress(value, message) { $('#progress>span').textContent = message; $('#progress i').style.width = `${value}%`; }
async function runBacktest() {
  if (state.running || !$('#config-form').reportValidity()) return;
  let options;
  try { options = readOptions(); } catch (e) { return notice(e.message); }
  notice(); busy(true); progress(2, '準備歷史行情與暖機資料…');
  const controller = new AbortController(); state.abort = controller;
  const source = state.source, symbols = [...state.symbols];
  try {
    const datasets = [];
    for (const [i, symbol] of symbols.entries()) {
      progress(3 + 12 * i / symbols.length, `下載 ${symbol}，含 220 根指標暖機…`);
      const params = new URLSearchParams({ market: options.market, symbol, interval: options.interval, start: options.startTime, end: options.endTime, demo: source === 'demo' ? '1' : '0' });
      let data;
      if (staticMode) data = source === 'demo'
        ? staticData[1].demoHistory(symbol, options.interval, options.startTime, options.endTime, options.market)
        : await staticData[0].getHistory({ market: options.market, symbol, interval: options.interval, startTime: options.startTime, endTime: options.endTime }, controller.signal);
      else {
        const res = await fetch(`/api/history?${params}`, { signal: controller.signal });
        data = await res.json(); if (!res.ok) throw new Error(data.error);
      }
      if (controller.signal.aborted) throw new DOMException('已停止', 'AbortError');
      if (options.strategy === 'combination' || options.strategy === 'combination-search') {
        data.timeframes = {};
        const neededIntervals = options.strategy === 'combination-search' ? combinationIntervals : [...new Set(options.combination.conditions.map(c => c.interval))];
        for (const interval of neededIntervals) {
          if (interval === options.interval) continue;
          progress(3 + 12 * i / symbols.length, `下載 ${symbol} 的 ${interval} 已收盤條件資料與暖機…`);
          const query = { market: options.market, symbol, interval, startTime: options.startTime, endTime: options.endTime, signalOnly: true };
          let frame;
          if (staticMode) frame = source === 'demo' ? staticData[1].demoHistory(symbol, interval, options.startTime, options.endTime, options.market) : await staticData[0].getHistory(query, controller.signal);
          else {
            const params = new URLSearchParams({ market: options.market, symbol, interval, start: options.startTime, end: options.endTime, demo: source === 'demo' ? '1' : '0', purpose: 'signals' });
            const response = await fetch(`/api/history?${params}`, { signal: controller.signal });
            frame = await response.json(); if (!response.ok) throw new Error(frame.error);
          }
          if (controller.signal.aborted) throw new DOMException('已停止', 'AbortError');
          data.timeframes[interval] = frame.candles;
        }
      }
      datasets.push(data);
    }
    if (new Set(datasets.map(d => d.quote)).size !== 1) throw new Error('多幣種回測必須使用同一報價幣');
    state.quote = datasets[0].quote; renderSymbols();
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); state.worker = worker;
    const result = await new Promise((resolve, reject) => {
      state.rejectWorker = reject;
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') progress(15 + data.progress * .85, data.message);
        if (data.type === 'result') resolve(data.result);
        if (data.type === 'error') reject(new Error(data.error));
      };
      worker.onerror = event => reject(new Error(event.message || '回測工作程序失敗'));
      worker.postMessage({ datasets, options });
    });
    result.metadata.quote = state.quote;
    state.datasets = datasets; state.result = result; state.range = options.strategy === 'combination' ? 'full' : 'test'; state.tradePage = 0; state.candleOffset = 0;
    renderResults(); progress(100, `${result.metadata.bars.toLocaleString()} 根 K 線 · ${result.metadata.candidates} 組候選 · 已完成`);
    if (result.metadata.commonPeriodTrimmed) notice('部分交易對歷史不足，回測已使用各交易對共同可用、完成暖機後的期間。請以圖表日期為準。');
    toast(options.strategy === 'combination' ? '條件組合回測完成，請查看逐幣結果' : options.strategy === 'combination-search' ? '自動搜尋完成，請查看三種冠軍與樣本外驗證' : '回測完成，已產生樣本外與滾動驗證報告');
  } catch (e) {
    if (e.name === 'AbortError') progress(0, '本次回測已停止');
    else { notice(e.message); progress(0, '回測未完成，請檢查上述訊息'); }
  } finally {
    state.worker?.terminate(); state.worker = null; state.rejectWorker = null; state.abort = null; busy(false);
  }
}
function currentReport() { return state.result?.[state.range]; }
function buildCandlestickMarkers(dataset) {
  const result = state.result, report = currentReport(), options = result.options, markers = [];
  const showPatterns = $('#candle-show-patterns')?.checked !== false;
  const showSignals = $('#candle-show-signals')?.checked !== false;
  const showTrades = $('#candle-show-trades')?.checked !== false;
  if (showPatterns && ['combination', 'combination-search'].includes(options.strategy)) {
    for (const condition of options.combination.conditions.filter(c => Object.hasOwn(patternCatalog, c.type))) {
      const candles = condition.interval === options.interval ? dataset.candles : dataset.timeframes?.[condition.interval];
      if (!candles) continue;
      for (let i = 0; i < candles.length; i++) if (detectPattern(candles, i, condition.type)) markers.push({
        time: candles[i].time + intervals[condition.interval] - 1, kind: 'pattern', bias: patternBias[condition.type],
        short: patternShortLabels[condition.type], label: `${condition.interval} ${patternCatalog[condition.type]}`,
      });
    }
  }
  if (showSignals && ['combination', 'combination-search'].includes(options.strategy)) {
    try {
      const timeframes = { ...(dataset.timeframes ?? {}), [options.interval]: dataset.candles };
      const { signals } = buildCombinationSignals(dataset.candles, timeframes, options.combination, options.interval);
      for (let i = 0; i < signals.length; i++) if (signals[i]) markers.push({
        time: dataset.candles[i].time + intervals[options.interval] - 1, kind: 'signal',
        label: `全部 AND 條件成立 → 下一根${options.combination.side === 'long' ? '做多' : '做空'}`,
      });
    } catch { /* Chart annotations must never break the completed report. */ }
  }
  if (showTrades) for (const trade of report.trades.filter(t => t.symbol === dataset.symbol)) {
    markers.push({ time: trade.entryTime, kind: 'entry', side: trade.side, label: `${trade.side === 'long' ? '做多' : '做空'}進場 @ ${price(trade.entry)}` });
    markers.push({ time: trade.exitTime, kind: 'exit', side: trade.side, label: `${({ signal: '策略出場', stop: '停損', target: '停利', end: '期末平倉', liquidation: '估計清算' })[trade.reason] ?? trade.reason} @ ${price(trade.exit)} · 損益 ${pct(trade.return)}` });
  }
  return markers;
}
function renderCandlestick() {
  const panel = $('#candlestick-panel'); if (!panel || !state.result || !state.datasets?.length) return;
  const symbols = state.result.metadata.symbols;
  if (!state.candleSymbol || !symbols.includes(state.candleSymbol)) state.candleSymbol = symbols[0];
  const selector = $('#candle-symbol');
  selector.innerHTML = symbols.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  selector.value = state.candleSymbol;
  const dataset = state.datasets.find(d => d.symbol === state.candleSymbol) ?? state.datasets[0], report = currentReport();
  const first = report.equity[0]?.time, last = report.equity.at(-1)?.time;
  const all = dataset.candles.filter(c => c.time >= first && c.time <= last);
  state.candleWindow = Number($('#candle-window-size')?.value || state.candleWindow || 120);
  const maxOffset = Math.max(0, all.length - 1);
  state.candleOffset = Math.max(0, Math.min(state.candleOffset, maxOffset));
  let end = Math.max(1, all.length - state.candleOffset), start = Math.max(0, end - state.candleWindow);
  if (end - start < state.candleWindow && start === 0) end = Math.min(all.length, state.candleWindow);
  const visible = all.slice(start, end);
  const markers = buildCandlestickMarkers(dataset);
  candlestickChart($('#candlestick-chart'), visible, markers);
  $('#candle-period').textContent = visible.length ? `${datetime(visible[0].time)} → ${datetime(visible.at(-1).time)} UTC · ${visible.length} 根` : '—';
  $('#candle-marker-count').textContent = `${markers.filter(m => visible.length && m.time >= visible[0].time && m.time < visible.at(-1).time + intervals[state.result.options.interval]).length} 個標記`;
  $('#candle-older').disabled = start === 0;
  $('#candle-newer').disabled = end >= all.length;
}
function renderSearchResults() {
  const result = state.result, container = $('#search-results');
  if (!container || result?.metadata.mode !== 'combination-search') return;
  const winnerMeta = [
    ['winRate', '◎ 勝率最高', '在符合最低交易數的候選中，訓練段勝率最高。'],
    ['stability', '◇ 最穩定', '綜合 Sharpe、Sortino、獲利因子、回撤、交易數與跨幣一致性。'],
    ['return', '↗ 獲利最多', '在符合最低交易數且無估計清算的候選中，訓練段淨報酬最高；回撤與跨幣一致性只列示，不參與此冠軍定義。'],
  ];
  const card = ([key, title, subtitle]) => {
    const row = result.winners?.[key];
    if (!row) return `<article class="search-winner-card unavailable"><span class="search-winner-kicker">${title}</span><h3>沒有候選達到門檻</h3><p>目前沒有策略在訓練段同時達到至少 ${result.metadata.minTrades} 筆交易且沒有估計清算。可增加日期、降低最低交易數或放寬候選條件。</p></article>`;
    const h = row.test, ratio = Math.round((row.testAssetsPositive ?? row.testScore?.consistency ?? 0) * 100);
    return `<article class="search-winner-card"><span class="search-winner-kicker">${title}</span><h3>${row.combination.side === 'long' ? '做多' : '做空'} · ${row.description}</h3><p class="search-card-sub">${subtitle}</p><div class="search-metrics"><span>樣本外勝率 <b>${num(h.winRate,1)}%</b></span><span>樣本外報酬 <b class="${color(h.totalReturn)}">${pct(h.totalReturn)}</b></span><span>最大回撤 <b class="negative">${num(h.maxDrawdown)}%</b></span><span>交易 <b>${h.trades}</b></span><span>Profit Factor <b>${h.noLosses ? '無虧損' : num(h.profitFactor)}</b></span><span>跨幣正報酬 <b>${ratio}%</b></span><span>正報酬月份 <b>${Math.round((row.testScore?.monthConsistency ?? 0)*100)}%</b></span></div><p><strong>設定：</strong>${result.options.market === 'futures' ? `${row.leverage}× 合約 · ` : ''}停損 ${num(row.stopLoss*100,1)}% · 停利 ${num(row.takeProfit*100,1)}%</p><p><strong>為什麼：</strong>${esc(row.explanation.why)}</p><p class="search-risk"><strong>風險：</strong>${esc(row.explanation.risk)}</p><button type="button" class="secondary" data-apply-search="${row.id}">套用到手動條件組合 →</button></article>`;
  };
  const rows = [...(result.searchRanking ?? [])];
  const sort = state.searchSort;
  rows.sort((a,b) => {
    if (sort === 'winRateScore') return b.train.winRate - a.train.winRate || b.train.trades - a.train.trades;
    if (sort === 'returnScore') return b.train.totalReturn - a.train.totalReturn || b.train.trades - a.train.trades;
    if (sort === 'drawdown') return b.test.maxDrawdown - a.test.maxDrawdown;
    if (sort === 'trades') return b.test.trades - a.test.trades;
    if (sort === 'consistency') return b.testScore.consistency - a.testScore.consistency;
    return b.trainScore.stabilityScore - a.trainScore.stabilityScore;
  });
  const rankingRows = rows.slice(0, 100).map((row, i) => `<tr><td><span class="rank-number">${String(i+1).padStart(2,'0')}</span><strong>${row.combination.side === 'long' ? '多' : '空'}</strong><span class="strategy-sub">${esc(row.description)}</span></td><td class="mono">${result.options.market === 'futures' ? row.leverage + '×' : '1×'}</td><td class="mono ${color(row.test.totalReturn)}">${pct(row.test.totalReturn)}</td><td class="mono">${num(row.test.winRate,1)}%</td><td class="mono negative">${num(row.test.maxDrawdown)}%</td><td>${row.test.trades}</td><td class="mono">${row.test.noLosses ? '∞' : num(row.test.profitFactor)}</td><td class="mono">${Math.round(row.testScore.consistency*100)}%</td><td><button type="button" class="add-market" data-apply-search="${row.id}">套用</button></td></tr>`).join('');
  container.innerHTML = `<div class="panel-heading"><div><h3>條件組合自動搜尋</h3><p>理論合理組合空間約 ${result.metadata.candidateSpace.toLocaleString()} 組；實際受候選上限控制，測試 ${result.metadata.candidates} 組。冠軍只用前 70% 選出，下面數字以最後 30% 樣本外為主。</p></div><span class="outline-badge">70% 選候選 / 30% 驗證</span></div><div class="search-winner-grid">${winnerMeta.map(card).join('')}</div><div class="search-ranking-head"><div><h3>全部候選排行</h3><p>排序會改變表格，不會重新挑冠軍或偷看樣本外。</p></div><label>排序<select id="search-ranking-sort"><option value="stabilityScore">穩定度</option><option value="winRateScore">勝率</option><option value="returnScore">報酬</option><option value="drawdown">最大回撤</option><option value="trades">交易次數</option><option value="consistency">跨幣一致性</option></select></label></div><div class="table-scroll"><table><thead><tr><th>候選條件</th><th>槓桿</th><th>樣本外報酬</th><th>勝率</th><th>最大回撤</th><th>交易數</th><th>PF</th><th>跨幣正報酬</th><th></th></tr></thead><tbody id="search-ranking-body">${rankingRows}</tbody></table></div><p class="detail-note">目前 K 線圖顯示「最穩定」冠軍的樣本外交易；若要深入看其他候選，按「套用」會把它完整帶回手動條件組合，再重新回測即可查看所有訊號與交易。</p>`;
  $('#search-ranking-sort').value = state.searchSort;
}
function applySearchCandidate(id) {
  const row = state.result?.searchRanking?.find(r => r.id === id);
  if (!row || state.running) return;
  $('#strategy').value = 'combination';
  initCombination(row.combination);
  $('#combo-stop').value = String(row.stopLoss * 100);
  $('#combo-target').value = String(row.takeProfit * 100);
  if (state.market === 'futures' && Number.isFinite(row.leverage)) {
    $('#leverage').value = String(row.leverage);
    $('#search-leverage').value = String(row.leverage);
  }
  strategyChanged();
  notice(`已套用自動搜尋候選：${row.description}。請按「開始回測」查看完整 K 線訊號與逐筆交易。`);
  $('#strategy').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderResults() {
  if (!state.result) return;
  const result = state.result, report = currentReport(), s = report.stats, source = result.metadata.sources[0].source;
  const combo = result.metadata.mode === 'combination', search = result.metadata.mode === 'combination-search';
  $('#combination-results').classList.toggle('hidden', !combo);
  $('#search-results')?.classList.toggle('hidden', !search);
  $('.ranking-panel').classList.toggle('hidden', combo || search);
  $('#range-selector').classList.toggle('hidden', combo);
  document.querySelectorAll('[data-tab="walk"], [data-tab="indicators"]').forEach(el => el.classList.toggle('hidden', combo || search));
  if (search) { if (['walk', 'indicators'].includes(state.tab)) state.tab = 'stats'; renderSearchResults(); }
  if (combo) {
    if (['walk', 'indicators'].includes(state.tab)) state.tab = 'stats';
    const profitable = report.assets.filter(a => a.totalReturn > 0 && a.trades > 0).length;
    const diagnostics = result.metadata.signalDiagnostics ?? [];
    const diagnosticRows = diagnostics.map(d => {
      const asset = report.assets.find(a => a.symbol === d.symbol);
      const detail = d.conditions.map(c => `${c.interval} ${conditionCatalog[c.type]}${c.type.startsWith('rsi') ? ` ${c.threshold}` : ''}：${c.hits} 次`).join('；');
      return `<tr><td>${esc(d.symbol)}</td><td>${d.readyBars}</td><td class="mono ${d.combinedHits ? 'positive' : 'negative'}">${d.combinedHits}</td><td>${asset?.trades ?? 0}</td><td class="signal-detail">${esc(detail)}</td></tr>`;
    }).join('');
    const runSettings = `${result.options.combination.side === 'long' ? '做多' : '做空'} · ${result.options.market === 'futures' ? `${result.options.leverage}× 合約` : '現貨'} · 停損 ${num(result.options.stopLoss * 100, 1)}% · 停利 ${num(result.options.takeProfit * 100, 1)}% · 每次用 ${num(result.options.allocation * 100, 0)}% 資金`;
    $('#combination-results').innerHTML = `<div class="panel-heading"><div><h3>所有勾選幣種是否全部正報酬</h3><p>完整共同期間 · 已扣手續費、滑價與合約資金費率</p><p class="combo-run-settings">${runSettings}</p></div></div><p id="all-positive" class="combo-verdict ${report.allPositive ? 'positive' : 'negative'}">${report.allPositive ? '是，全部正報酬' : '否，並非全部正報酬'}（${profitable} / ${report.assets.length}）</p><div class="table-scroll"><table><thead><tr><th>幣種</th><th>淨報酬</th><th>勝率</th><th>交易次數</th><th>最大回撤</th><th>結果</th></tr></thead><tbody id="combination-assets">${report.assets.map(a => `<tr><td>${esc(a.symbol)}</td><td class="mono ${color(a.totalReturn)}">${pct(a.totalReturn)}</td><td class="mono">${a.trades ? `${num(a.winRate)}%` : '—'}</td><td>${a.trades}</td><td class="mono negative">${num(a.maxDrawdown)}%</td><td>${!a.trades ? '無交易' : a.totalReturn > 0 ? '正報酬' : a.totalReturn < 0 ? '虧損' : '零報酬'}</td></tr>`).join('')}</tbody></table></div><details class="signal-diagnostics" ${report.stats.trades === 0 ? 'open' : ''}><summary>為什麼有／沒有開單？查看訊號診斷</summary><p>「單一條件命中」代表該條件自己成立；「全部同時成立」才會產生進場訊號。交叉與 K 線型態只在發生的那根收盤時算成立。</p><div class="table-scroll"><table><thead><tr><th>幣種</th><th>可判定 K 線</th><th>全部同時成立</th><th>實際交易</th><th>各條件命中次數</th></tr></thead><tbody id="signal-diagnostics-body">${diagnosticRows}</tbody></table></div></details><p class="detail-note">零報酬、無交易不算正報酬。若「全部同時成立」是 0，表示 AND 條件在本期間沒有同時出現，不是資金 5 USDT 阻止下單。示範資料僅供練習；歷史結果不代表未來。</p>`;
  }
  const benchmarkReturn = (report.benchmark.at(-1).value / result.options.capital - 1) * 100;
  $('#report-state').textContent = `${source === 'synthetic' ? '合成示範結果' : '幣安資料'} · ${result.options.market === 'spot' ? '現貨' : `${result.options.leverage}× 合約`} · ${result.metadata.symbols.join(' / ')}`;
  const cards = [
    ['這次賺／賠多少', pct(s.totalReturn), color(s.totalReturn), `假設投入 <strong>${num(result.options.capital)} ${result.metadata.quote}</strong>`, '↗'],
    ['最慘曾跌多少', `${num(s.maxDrawdown)}%`, 'negative', '從某個高點往下最多跌這麼多', '↘'],
    ['交易勝率', `${num(s.winRate, 1)}%`, '', `<strong>${s.wins}</strong> 次賺錢 / <strong>${s.losses}</strong> 次賠錢 · 共 ${s.trades} 次`, '◎'],
    ['最後剩多少', `${num(s.endValue)}`, color(s.netProfit), `${result.metadata.quote} · 買著不動同期 ${pct(benchmarkReturn)}`, '◈'],
  ];
  $('#summary').innerHTML = cards.map(([label, value, cls, sub, icon]) => `<div class="stat-card"><div class="stat-label">${label}<span>${icon}</span></div><div class="stat-value ${cls}">${value}</div><div class="stat-sub">${sub}</div></div>`).join('');
  const plain = beginnerStrategy(result.best);
  const resultText = s.trades === 0 ? '沒有開單（0 筆交易）' : s.totalReturn > 0 ? `這次回測有獲利 ${pct(s.totalReturn)}` : s.totalReturn < 0 ? `這次回測是虧損 ${pct(s.totalReturn)}` : '有交易，但總報酬為 0.00%';
  $('#plain-summary').innerHTML = `<div class="plain-strategy"><span class="plain-kicker">這次系統選到的交易方法</span><h3>${esc(plain.name)}</h3><small>原技術名稱：${esc(plain.technical)} · ${esc(plain.indicators)}</small><p><b>怎麼買、怎麼賣：</b>${esc(plain.rule)}</p></div><div class="plain-result"><strong class="${s.trades === 0 ? 'amber' : color(s.totalReturn)}">${resultText}</strong><span>假設 ${num(result.options.capital)} ${result.metadata.quote} → ${num(s.endValue)} ${result.metadata.quote}</span><span>過程中從高點最多曾回落 ${num(s.maxDrawdown)}%</span><em>${s.trades === 0 && combo ? '請展開上方「訊號診斷」，查看是哪個 AND 條件沒有同時成立。' : '這只是歷史資料模擬，不代表之後一定會有相同結果。'}</em></div>`;
  $('#chart-caption').textContent = `${plain.name} · ${source === 'synthetic' ? '練習用示範資料' : 'Binance 歷史資料'} · ${state.range === 'test' ? '最後 30% 資料另外測試' : '整段歷史資料'}`;
  if (combo) $('#plain-summary .plain-kicker').textContent = '你勾選的 AND 進場條件';
  if (search) $('#plain-summary .plain-kicker').textContent = '目前顯示：自動搜尋的「最穩定」候選';
  $('#chart-unit').textContent = result.metadata.quote;
  $('#period-label').textContent = `${date(report.equity[0].time)} — ${date(report.equity.at(-1).time)} UTC`;
  $('#drawdown-max').textContent = `${num(s.maxDrawdown)}%`;
  $('#detail-range-label').textContent = state.range === 'test' ? '樣本外期間' : '完整期間';
  $$('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === state.range));
  equityChart($('#equity-chart'), report); drawdownChart($('#drawdown-chart'), report.equity); renderCandlestick();
  $('#candidate-count').textContent = result.ranking.length;
  if (!search) {
    $('#ranking-body').innerHTML = result.ranking.map((r, i) => { const p = beginnerStrategy(r.strategy); return `<tr><td><span class="rank-number ${i === 0 ? 'winner' : ''}">${String(i + 1).padStart(2, '0')}</span><span class="strategy-name">${esc(p.name)}</span>${i === 0 ? '<span class="best-pill">前段表現最好</span>' : ''}<span class="strategy-sub">${esc(p.rule)}</span></td><td class="mono ${color(r.train.totalReturn)}">${pct(r.train.totalReturn)}</td><td class="mono ${color(r.test.totalReturn)}">${pct(r.test.totalReturn)}</td><td class="mono negative">${num(r.test.maxDrawdown)}%</td><td class="mono">${r.test.trades}</td></tr>`; }).join('');
    const top = result.ranking[0], topPlain = beginnerStrategy(top.strategy);
    $('#ranking-insight').innerHTML = `✧ 前 70% 資料裡，<strong>${esc(topPlain.name)}</strong> 表現最好；拿最後 30% 沒參與挑選的資料再測，結果是 <strong>${pct(top.test.totalReturn)}</strong>。${top.train.trades < 3 || top.train.sharpe === null ? ' 但交易次數太少，先不要把這個結果看得太重。' : ''}${top.test.totalReturn > 0 ? ' 後段仍為正報酬，但還要一起看最慘跌幅與交易次數。' : ' 後段變成虧損，表示前段好成績沒有穩定延續。'}${source === 'synthetic' ? ' 目前是練習資料，不能拿來判斷真實市場。' : ''}`;
  }
  renderDetail();
}
const reasons = { signal: '策略出場', stop: '停損 / 移動停損', target: '停利', end: '期末平倉', liquidation: '估計清算' };
function renderDetail() {
  if (!state.result) { $('#detail-content').innerHTML = '<div class="empty-state">完成回測後查看詳細報告</div>'; return; }
  const report = currentReport(), s = report.stats, r = state.result;
  $$('.detail-tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === state.tab); b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); });
  if (state.tab === 'stats') {
    const data = [['期末淨值', num(s.endValue), r.metadata.quote], ['淨利', num(s.netProfit), '已扣成本與資金費率'], ['年化報酬 CAGR', s.cagr === null ? '—' : `${num(s.cagr)}%`, '不足 30 天不年化'], ['Sortino 比率', num(s.sortino), '日頻下行風險'], ['Calmar 比率', num(s.calmar), 'CAGR / 最大回撤'], ['獲利因子', s.noLosses ? '無虧損樣本' : num(s.profitFactor), '獲利總額 / 虧損總額'], ['每筆期望值', num(s.expectancy), r.metadata.quote], ['平均盈利', num(s.avgWin), r.metadata.quote], ['平均虧損', num(s.avgLoss), r.metadata.quote], ['最長連敗', String(s.maxLossStreak), '依平倉順序'], ['總手續費', num(s.fees), '雙邊成交收費'], ['滑價成本', num(s.slippageCost), '已含於成交價，未重複扣除'], ['淨資金費率支出', num(s.funding), '負數代表收取'], ['平均持倉', `${num(s.avgHoldingHours, 1)} h`, '小時'], ['市場曝險時間', `${num(s.exposure, 1)}%`, `${s.liquidations} 次估計清算`]];
    const assets = `<div class="table-scroll"><table><thead><tr><th>獨立資金帳戶</th><th>淨報酬</th><th>勝率</th><th>最大回撤</th><th>Sharpe</th><th>交易數</th><th>手續費</th><th>淨資金費率支出</th></tr></thead><tbody>${report.assets.map(a => `<tr><td>${esc(a.symbol)}</td><td class="mono ${color(a.totalReturn)}">${pct(a.totalReturn)}</td><td class="mono">${a.trades ? `${num(a.winRate)}%` : '—'}</td><td class="mono negative">${num(a.maxDrawdown)}%</td><td class="mono">${num(a.sharpe)}</td><td>${a.trades}</td><td class="mono">${num(a.fees)}</td><td class="mono">${num(a.funding)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#detail-content').innerHTML = `<div class="stats-grid">${data.map(([label, value, hint]) => `<div class="detail-stat"><label>${label}</label><strong>${value}</strong><small>${esc(hint)}</small></div>`).join('')}</div>${assets}<div class="detail-note">${r.metadata.warnings.map(esc).join(' ')} ${s.trades < 20 ? '本期間交易少於 20 筆，統計證據有限。' : ''}</div>`;
  } else if (state.tab === 'trades') renderTrades();
  else if (state.tab === 'monthly') $('#detail-content').innerHTML = `<div class="heatmap">${s.monthly.map(m => `<div class="month-cell ${m.return < 0 ? 'loss' : ''}"><small>${m.month}</small><strong>${pct(m.return)}</strong></div>`).join('')}</div><div class="detail-note">依 UTC 月末淨值計算，包含未實現損益；首末月份可能不完整。</div>`;
  else if (state.tab === 'walk') $('#detail-content').innerHTML = `<div class="fold-grid">${r.folds.map((f, i) => `<div class="fold"><h4>FOLD 0${i + 1} · 樣本外</h4><span class="dates">${date(f.start)} → ${date(f.end)}</span><strong class="${color(f.test.totalReturn)}">${pct(f.test.totalReturn)}</strong><p>本折訓練首選：${esc(f.strategy)}</p><div class="fold-stats"><span>Sharpe ${num(f.test.sharpe)}</span><span>回撤 ${num(f.test.maxDrawdown)}%</span><span>${f.test.trades} 筆</span></div></div>`).join('')}</div><div class="detail-note">固定使用總期間 50% 作訓練窗，向前滾動 3 折。每折先選參數，再測未見資料，獨立重新配置起始資金。各折報酬不可直接相加，也不是上方 70/30 保留資料的獨立額外樣本。</div>`;
  else $('#detail-content').innerHTML = `<div class="snapshot-grid">${Object.entries(r.snapshot).map(([key, v]) => `<div class="snapshot-item"><small>${esc(indicatorCatalog[key] ?? key)}</small><strong>${num(v, Math.abs(v) < 1 ? 6 : 2)}</strong></div>`).join('')}</div><div class="detail-note">${esc(r.metadata.symbols[0])} · 歷史資料最後一根已收盤 K 線（${datetime(r.metadata.end)} UTC），不是即時指標。null／不足暖機顯示「—」。</div>`;
}
function renderTrades() {
  const rows = currentReport().trades.filter(t => !state.tradeSide || t.side === state.tradeSide), size = 20;
  const pages = Math.max(1, Math.ceil(rows.length / size)); state.tradePage = Math.min(state.tradePage, pages - 1);
  $('#detail-content').innerHTML = `<div class="detail-toolbar"><span>完整成交紀錄 · UTC</span><select id="trade-side" aria-label="交易方向"><option value="">全部方向</option><option value="long">做多</option><option value="short">做空</option></select><span>${rows.length} 筆</span><button class="secondary" id="export-trades">↓ 匯出全部交易 CSV</button></div><div class="table-scroll"><table><thead><tr><th>交易對 / 方向</th><th>進場時間</th><th>出場時間</th><th>進場價</th><th>出場價</th><th>數量</th><th>淨損益</th><th>保證金報酬</th><th>手續費</th><th>資金費率</th><th>出場原因</th></tr></thead><tbody>${rows.slice(state.tradePage * size, (state.tradePage + 1) * size).map(t => `<tr><td>${esc(t.symbol)} <span class="${t.side === 'long' ? 'positive' : 'negative'}">${t.side === 'long' ? '多' : '空'}</span></td><td class="mono">${datetime(t.entryTime)}</td><td class="mono">${datetime(t.exitTime)}</td><td class="mono">${price(t.entry)}</td><td class="mono">${price(t.exit)}</td><td class="mono">${num(t.qty, 5)}</td><td class="mono ${color(t.pnl)}">${num(t.pnl)}</td><td class="mono ${color(t.return)}">${pct(t.return)}</td><td class="mono">${num(t.fees)}</td><td class="mono">${num(t.funding)}</td><td>${reasons[t.reason]}</td></tr>`).join('') || '<tr><td colspan="11" class="empty-state">此期間沒有符合條件的交易；請調整策略或日期。</td></tr>'}</tbody></table></div><div class="pagination"><span>${state.tradePage + 1} / ${pages}</span><button data-trade-page="-1" ${state.tradePage === 0 ? 'disabled' : ''}>←</button><button data-trade-page="1" ${state.tradePage >= pages - 1 ? 'disabled' : ''}>→</button></div>`;
  $('#trade-side').value = state.tradeSide;
}
function download(name, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportTrades() {
  if (!state.result) return toast('請先執行回測');
  const keys = ['symbol', 'side', 'entryTime', 'exitTime', 'entry', 'exit', 'qty', 'pnl', 'return', 'fees', 'funding', 'slippageCost', 'reason'];
  const safe = v => { const text = String(v); return `"${(typeof v === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };
  const rows = currentReport().trades.map(t => keys.map(key => safe(key.endsWith('Time') ? new Date(t[key]).toISOString() : t[key])).join(','));
  download(`quantlab-${state.range}-trades.csv`, '\ufeff' + [keys.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
}
function saveConfig() {
  const values = Object.fromEntries(new FormData($('#config-form')));
  const config = { version: 1, market: state.market, symbols: state.symbols, quote: state.quote, values, optimize: $('#optimize').checked, searchRisk: $('#search-risk')?.checked ?? false, searchLeverageSearch: $('#search-leverage-search')?.checked ?? false, rules: readRules(), combination: readCombination() };
  try { localStorage.setItem('quantlab-config-v1', JSON.stringify(config)); toast('設定已儲存在此瀏覽器'); } catch { toast('此瀏覽器不允許本機儲存'); }
}
async function loadConfig() {
  if (state.running) return;
  try {
    const config = JSON.parse(localStorage.getItem('quantlab-config-v1'));
    if (!config || config.version !== 1) return toast('尚無已儲存的設定');
    await switchMarket(config.market);
    for (const [name, value] of Object.entries(config.values)) { const element = $('#config-form').elements.namedItem(name); if (element && element.type !== 'checkbox') element.value = value; }
    state.symbols = config.symbols.slice(0, MAX_SYMBOLS); state.quote = config.quote; $('#optimize').checked = config.optimize; if ($('#search-risk')) $('#search-risk').checked = !!config.searchRisk; if ($('#search-leverage-search')) $('#search-leverage-search').checked = !!config.searchLeverageSearch;
    initRules(config.rules); initCombination(config.combination); strategyChanged(); renderSymbols(); await sourceChanged(); toast('已載入設定，執行回測即可更新結果');
  } catch { toast('儲存的設定無法讀取'); }
}
function initContent() {
  $('#help-button').title = '新手回測教學'; $('#help-button').setAttribute('aria-label', '新手回測教學');
  $('#strategy').insertAdjacentHTML('beforeend', '<option value="combination-search">🧠 條件組合自動搜尋（找勝率／穩定／獲利冠軍）</option><option value="combination">✓ 條件組合回測（自己勾選條件）</option>');
  $('#selected-symbols').insertAdjacentHTML('afterend', `<div class="symbol-picker-actions"><button type="button" class="secondary" id="open-symbol-picker">☰ 點選幣種</button><span id="symbol-picker-count">已選 ${state.symbols.length} / ${MAX_SYMBOLS}</span></div><div class="mover-shortcuts"><span>Binance 合約 24h 快速選取</span><button type="button" data-mover-preset="gainers10">漲幅前 10</button><button type="button" data-mover-preset="gainers15">漲幅前 15</button><button type="button" data-mover-preset="losers10">跌幅前 10</button><button type="button" data-mover-preset="losers15">跌幅前 15</button><small>會自動切換到 Binance 真實行情＋USDT 永續合約，並取代目前選取。</small></div><dialog id="symbol-picker-dialog" class="symbol-picker-dialog"><div class="symbol-picker-head"><div><h3>點選回測幣種</h3><p>直接點選，不用輸入代碼。最多 ${MAX_SYMBOLS} 個。</p></div><button type="button" id="close-symbol-picker" aria-label="關閉">×</button></div><input id="symbol-picker-search" type="search" placeholder="搜尋 BTC、ETH、SOL…"><div class="symbol-picker-toolbar"><span id="symbol-picker-count-modal"></span><button type="button" id="clear-symbols">清除全部</button></div><div id="symbol-checkboxes" class="symbol-picker-list"></div><div class="symbol-picker-foot"><button type="button" class="primary" id="done-symbol-picker">完成選擇</button></div></dialog>`);
  $('#plain-summary').insertAdjacentHTML('beforebegin', '<section id="search-results" class="panel hidden" aria-label="條件組合自動搜尋結果"></section><section id="combination-results" class="panel hidden" aria-label="條件組合逐幣結果"></section>');
  initCombination();
  $('#strategy').insertAdjacentHTML('beforeend', strategyCatalog.map(s => { const p = beginnerStrategy(s); return `<option value="${s.id}">${p.name}（${s.name}）</option>`; }).join('') + '<option value="custom">＋ 我自己設定買賣條件</option>');
  $('#strategy-cards').innerHTML = strategyCatalog.map((s, i) => { const p = beginnerStrategy(s); return `<article class="strategy-card"><div class="strategy-number">方法 ${String(i + 1).padStart(2, '0')}</div><h3>${esc(p.name)}</h3><div class="indicator-label">技術名稱：${esc(s.name)} · ${esc(s.indicators)}</div><p><b>簡單說：</b>${esc(p.intro)}</p><p><b>實際規則：</b>${esc(p.rule)}</p><button class="secondary" data-use-strategy="${s.id}">用這個方法回測 →</button></article>`; }).join('');
  $('#indicator-tags').innerHTML = Object.entries(indicatorCatalog).map(([key, label]) => `<span class="indicator-tag" title="規則代碼：${key}">${label}</span>`).join('');
  const sections = [
    ['01 / 資料範圍', '現貨載入幣安目前所有可交易交易對。合約支援 USDⓈ-M 的 USDT／USDC 永續，雙向交易、1–10 倍逐倉模型；不包含 COIN-M 或交割合約。公開行情不需要 API 金鑰。示範資料是可重現的合成序列，不能據以判斷真實獲利。'],
    ['02 / 訊號與成交', '先下載額外 220 根 K 線暖機，再使用至少 200 根歷史建立指標。第 t 根收盤計算訊號，在第 t+1 根開盤用市價成交。每交易對同時只持有一個方向；訊號平倉當根不反手。期末會強制平倉，確保費用與損益完整入帳。'],
    ['03 / 停損與成本', '手續費於進出場分別計算，滑價永遠採不利方向。跳空越過停損時使用開盤價，不假設能以停損價成交。同根 K 線同時觸及停損、停利時採停損；若亦碰觸清算則清算優先。移動停損只根據已完成的收盤價調整，下一根才生效。'],
    ['04 / 合約與清算', '資金費率使用歷史事件的標記價格，正費率由多方支付、空方收取。僅提供 5m／15m／1h，事件歸入該 K 線開盤前持倉。淨值與清算使用標記價格 K 線。清算採固定可調維持保證金率，估計清算時沒收剩餘逐倉保證金；不等於交易所分級維持保證金、保險基金、ADL 或精確清算費。'],
    ['05 / 策略選擇與驗證', '前 70% 作訓練，最後 30% 保留驗證。排名分數為「訓練 Sharpe − |最大回撤 %| / 25 + min(交易數, 30) / 100」。少於 3 筆交易、無有效 Sharpe 或曾清算的候選降級。只有訓練結果參與選擇，樣本外從原始資金重新開始。另用固定 50% 訓練窗跑 3 折滾動驗證，各折獨立選策略。'],
    ['06 / 統計定義', '加密資產以一年 365 天計算。Sharpe 與 Sortino 使用 UTC 日末淨值日報酬、零無風險利率；少於 7 天不提供。CAGR 少於 30 天不年化。回撤使用含未實現損益的逐根淨值。買入持有為同成本、無槓桿、不含資金費率的價格基準。多幣種等額分配各自獨立帳戶，沒有再平衡或跨資產保證金。'],
    ['07 / 結果的適用範圍', '歷史回測不能保證未來報酬。清單來自目前仍交易的資產，存在倖存者偏誤。未模擬委託簿、成交量限制、最小下單量、交易所精度與稅費。大量參數搜尋、反覆查看樣本外再調參，仍然會過度擬合。請比較多種市場狀況與足夠交易樣本。平台不會下單。'],
    ['08 / 可重現的研究', '研究報告 JSON 包含完整設定、策略參數、資料來源與取得時間、排名、淨值、逐筆交易、滾動驗證及原始 K 線／資金費率，可用 npm run replay 離線重播。CSV 提供目前檢視期間全部交易。市場報價透過 WebSocket 更新，失敗時改為每 15 秒 REST 輪詢；歷史資料失敗會明確報錯，不會自動改用合成資料。'],
  ];
  $('#method-content').innerHTML = '<div class="method-flow"><span>歷史資料 + 暖機</span> → <span>70% 訓練選策略</span> → <span>30% 樣本外驗證</span></div>' + sections.map(([title, text]) => `<div class="method-block"><h3>${title}</h3><p>${text}</p></div>`).join('');
  const today = new Date(); const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  $('#end-date').value = date(end); $('#start-date').value = date(end - 90 * 86400000);
  $('#end-date').max = date(end); $('#start-date').max = date(end);
  $('#summary').innerHTML = ['這次賺／賠多少', '最慘曾跌多少', '交易勝率', '最後剩多少'].map(label => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">—</div><div class="stat-sub">等待回測</div></div>`).join('');
  $('#equity-chart').innerHTML = '<div class="chart-empty">正在準備研究資料…</div>';
  initRules(); renderSymbols(); renderDetail();
}
async function applyTutorialPreset(preset) {
  if (state.running || state.applyingTutorial) return toast('請等目前回測完成，再套用練習設定');
  if (!['long', 'short', 'cross'].includes(preset)) return;
  state.applyingTutorial = true;
  try {
    $('#source').value = 'demo';
    await switchMarket(preset === 'long' ? 'spot' : 'futures');
    state.symbols = ['BTCUSDT', 'ETHUSDT']; state.quote = 'USDT'; $('#symbol-search').value = ''; renderSymbols();
    $('#strategy').value = 'combination'; $('#capital').value = '10000'; $('#leverage').value = '1';
    $('#allocation').value = '95'; $('#slippage').value = '0.05'; $('#maintenance').value = '0.5';
    $('#combo-stop').value = '2'; $('#combo-target').value = '4'; $('#combo-overbought').value = '70'; $('#combo-oversold').value = '30';
    const conditions = preset === 'long' ? [{ interval: '4h', type: 'rsiOversold', threshold: 30 }] : preset === 'short' ? [{ interval: '1d', type: 'rsiOverbought', threshold: 70 }, { interval: '4h', type: 'macdDeath' }] : [{ interval: '4h', type: 'emaDeath' }, { interval: '4h', type: 'macdDeath' }];
    initCombination({ side: preset === 'long' ? 'long' : 'short', conditions });
    const now = new Date(), end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    $('#end-date').value = date(end); $('#start-date').value = date(end - 90 * 86400000);
    strategyChanged(); view('workbench');
    notice('已套用教學練習：BTCUSDT、ETHUSDT，最近 90 天合成示範資料。請按「開始回測」，完成後查看逐幣結果。示範績效不是幣安真實行情。');
    $('#strategy').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally { state.applyingTutorial = false; }
}
document.addEventListener('click', event => {
  const el = event.target.closest('button, a.brand'); if (!el) return;
  if (el.dataset.termHelp) { event.preventDefault(); event.stopPropagation(); showTermHelp(el.dataset.termHelp); return; }
  if (el.id === 'close-term-help') { const dialog = $('#term-help-dialog'); if (dialog?.close) dialog.close(); else dialog?.removeAttribute('open'); return; }
  if (el.dataset.view) view(el.dataset.view);
  if (el.dataset.tutorialPreset) applyTutorialPreset(el.dataset.tutorialPreset).catch(e => notice(e.message));
  if (el.matches('.brand')) view('workbench');
  if (el.id === 'help-button') view('tutorial');
  if (el.dataset.market) switchMarket(el.dataset.market);
  if (el.id === 'open-symbol-picker') { renderSymbolCheckboxes(); const dialog = $('#symbol-picker-dialog'); if (dialog?.showModal) dialog.showModal(); else if (dialog) dialog.setAttribute('open', ''); }
  if (el.id === 'close-symbol-picker' || el.id === 'done-symbol-picker') { const dialog = $('#symbol-picker-dialog'); if (dialog?.close) dialog.close(); else dialog?.removeAttribute('open'); }
  if (el.id === 'clear-symbols') { if (!state.running) { state.symbols = []; renderSymbols(); markDirty(); } }
  if (el.dataset.moverPreset) applyFuturesMoverPreset(el.dataset.moverPreset);
  if (el.dataset.applySearch) applySearchCandidate(el.dataset.applySearch);
  if (el.id === 'connect-live' || el.id === 'use-demo') { if (state.running) return; $('#source').value = el.id === 'connect-live' ? 'live' : 'demo'; sourceChanged(); }
  if (el.dataset.removeSymbol) { if (state.running) return; state.symbols = state.symbols.filter(s => s !== el.dataset.removeSymbol); renderSymbols(); markDirty(); }
  if (el.dataset.addSymbol) { const before = state.symbols.length; addSymbol(el.dataset.addSymbol); if (state.symbols.length > before) toast('已加入回測交易對'); }
  if (el.dataset.marketPage) { state.marketPage += Number(el.dataset.marketPage); renderMarkets(); }
  if (el.dataset.tradePage) { state.tradePage += Number(el.dataset.tradePage); renderTrades(); }
  if (el.dataset.range) { state.range = el.dataset.range; state.tradePage = 0; state.candleOffset = 0; renderResults(); }
  if (el.dataset.candleNav) { state.candleOffset = Math.max(0, state.candleOffset + Number(el.dataset.candleNav) * state.candleWindow); renderCandlestick(); }
  if (el.dataset.tab) { state.tab = el.dataset.tab; renderDetail(); }
  if (el.dataset.useStrategy) { if (state.running) return; $('#strategy').value = el.dataset.useStrategy; strategyChanged(); view('workbench'); $('#strategy').focus(); }
  if (el.classList.contains('add-rule')) { const list = el.previousElementSibling; if (list.children.length < 8) list.append(ruleRow()); markDirty(); }
  if (el.classList.contains('remove-rule')) { el.closest('.rule-row').remove(); markDirty(); }
  if (el.id === 'cancel-button') { state.abort?.abort(); state.worker?.terminate(); state.rejectWorker?.(new DOMException('已停止', 'AbortError')); }
  if (el.id === 'export-report') { if (!state.result) return toast('請先執行回測'); download(`quantlab-report-${date(Date.now())}.json`, JSON.stringify({ version: 1, ...state.result, datasets: state.datasets }, null, 2), 'application/json'); }
  if (el.id === 'export-trades') exportTrades();
  if (el.id === 'save-config') saveConfig();
  if (el.id === 'load-config') loadConfig();
  if (el.id === 'refresh-markets') refreshMarkets();
});
document.addEventListener('change', event => {
  if (event.target.dataset.checkSymbol) {
    if (state.running) return;
    if (event.target.checked) addSymbol(event.target.dataset.checkSymbol);
    else { state.symbols = state.symbols.filter(s => s !== event.target.dataset.checkSymbol); renderSymbols(); markDirty(); }
    renderSymbolCheckboxes();
  }
  if (event.target.dataset.comboType || ['combination-side', 'combo-overbought', 'combo-oversold'].includes(event.target.id)) { updateCombinationDescription(); markDirty(); }
  if (event.target.id === 'source') sourceChanged();
  if (event.target.id === 'strategy') strategyChanged();
  if (event.target.id === 'symbol-search') { const symbol = event.target.value.trim().toUpperCase(); addSymbol(symbol); event.target.value = ''; }
  if (event.target.id === 'quote-filter') { state.marketPage = 0; renderMarkets(); }
  if (event.target.id === 'trade-side') { state.tradeSide = event.target.value; state.tradePage = 0; renderTrades(); }
  if (event.target.id === 'search-ranking-sort') { state.searchSort = event.target.value; renderSearchResults(); }
  if (event.target.id === 'candle-symbol') { state.candleSymbol = event.target.value; state.candleOffset = 0; renderCandlestick(); }
  if (event.target.id === 'candle-window-size') { state.candleWindow = Number(event.target.value); state.candleOffset = 0; renderCandlestick(); }
  if (['candle-show-patterns', 'candle-show-signals', 'candle-show-trades'].includes(event.target.id)) renderCandlestick();
});
$('#market-search').addEventListener('input', () => { state.marketPage = 0; renderMarkets(); });
$('#symbol-search').addEventListener('input', renderSymbolCheckboxes);
document.addEventListener('input', event => { if (event.target.id === 'symbol-picker-search') renderSymbolCheckboxes(); });
$('#config-form').addEventListener('input', markDirty);
$('#config-form').addEventListener('submit', event => { event.preventDefault(); runBacktest(); });
initContent();
installBeginnerHelp();
const initialView = location.hash.slice(1); if (['workbench', 'tutorial', 'markets', 'strategies', 'method'].includes(initialView)) view(initialView);
else if (initialView.startsWith('tutorial-') && document.getElementById(initialView)) { view('tutorial'); document.getElementById(initialView).scrollIntoView(); }
await refreshMarkets();
runBacktest();
