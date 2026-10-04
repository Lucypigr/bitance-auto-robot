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
const state = { source: 'demo', market: 'spot', symbols: ['BTCUSDT'], markets: [], result: null, range: 'test', tab: 'stats', running: false, marketPage: 0, tradePage: 0, tradeSide: '', view: 'workbench', worker: null, ws: null, generation: 0, quote: 'USDT', pickingMovers: false, candleSymbol: null, candleOffset: 0, candleWindow: 120 };
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
  if (strategy?.id === 'combination') return { name: '條件組合回測', technical: '跨週期 AND', indicators: '只用已收盤 K 線', rule: strategy.combination.conditions.map(c => `${c.interval} ${conditionCatalog[c.type]}${c.type.startsWith('rsi') ? ` ${c.threshold}` : ''}`).join(' ＋ ') + `，全部符合才${strategy.combination.side === 'long' ? '做多' : '做空'}；停損、停利或期末平倉。` };
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
  const id = $('#strategy').value;
  $('#custom-builder').classList.toggle('hidden', id !== 'custom');
  $('#combination-builder').classList.toggle('hidden', id !== 'combination');
  $('#interval').disabled = id === 'combination';
  if (id === 'combination') { $('#strategy-hint').textContent = '依你勾選的條件測整段期間，不自動選策略。每個幣種都會列出淨報酬、勝率、交易次數、最大回撤。'; updateCombinationDescription(); markDirty(); return; }
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
  if (!active) $('#interval').disabled = $('#strategy').value === 'combination';
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
      if (options.strategy === 'combination') {
        data.timeframes = {};
        for (const interval of new Set(options.combination.conditions.map(c => c.interval))) {
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
    state.datasets = datasets; state.result = result; state.range = options.strategy === 'combination' ? 'full' : 'test'; state.tradePage = 0;
    renderResults(); progress(100, `${result.metadata.bars.toLocaleString()} 根 K 線 · ${result.metadata.candidates} 組候選 · 已完成`);
    if (result.metadata.commonPeriodTrimmed) notice('部分交易對歷史不足，回測已使用各交易對共同可用、完成暖機後的期間。請以圖表日期為準。');
    toast(options.strategy === 'combination' ? '條件組合回測完成，請查看逐幣結果' : '回測完成，已產生樣本外與滾動驗證報告');
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
  if (showPatterns && options.strategy === 'combination') {
    for (const condition of options.combination.conditions.filter(c => Object.hasOwn(patternCatalog, c.type))) {
      const candles = condition.interval === options.interval ? dataset.candles : dataset.timeframes?.[condition.interval];
      if (!candles) continue;
      for (let i = 0; i < candles.length; i++) if (detectPattern(candles, i, condition.type)) markers.push({
        time: candles[i].time + intervals[condition.interval] - 1, kind: 'pattern', bias: patternBias[condition.type],
        short: patternShortLabels[condition.type], label: `${condition.interval} ${patternCatalog[condition.type]}`,
      });
    }
  }
  if (showSignals && options.strategy === 'combination') {
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
function renderResults() {
  if (!state.result) return;
  const result = state.result, report = currentReport(), s = report.stats, source = result.metadata.sources[0].source;
  const combo = result.metadata.mode === 'combination';
  $('#combination-results').classList.toggle('hidden', !combo);
  $('.ranking-panel').classList.toggle('hidden', combo);
  $('#range-selector').classList.toggle('hidden', combo);
  $$('[data-tab="walk"], [data-tab="indicators"]').forEach(el => el.classList.toggle('hidden', combo));
  if (combo) {
    if (['walk', 'indicators'].includes(state.tab)) state.tab = 'stats';
    const profitable = report.assets.filter(a => a.totalReturn > 0 && a.trades > 0).length;
    $('#combination-results').innerHTML = `<div class="panel-heading"><div><h3>所有勾選幣種是否全部正報酬</h3><p>完整共同期間 · 已扣手續費、滑價與合約資金費率</p></div></div><p id="all-positive" class="combo-verdict ${report.allPositive ? 'positive' : 'negative'}">${report.allPositive ? '是，全部正報酬' : '否，並非全部正報酬'}（${profitable} / ${report.assets.length}）</p><div class="table-scroll"><table><thead><tr><th>幣種</th><th>淨報酬</th><th>勝率</th><th>交易次數</th><th>最大回撤</th><th>結果</th></tr></thead><tbody id="combination-assets">${report.assets.map(a => `<tr><td>${esc(a.symbol)}</td><td class="mono ${color(a.totalReturn)}">${pct(a.totalReturn)}</td><td class="mono">${a.trades ? `${num(a.winRate)}%` : '—'}</td><td>${a.trades}</td><td class="mono negative">${num(a.maxDrawdown)}%</td><td>${!a.trades ? '無交易' : a.totalReturn > 0 ? '正報酬' : a.totalReturn < 0 ? '虧損' : '零報酬'}</td></tr>`).join('')}</tbody></table></div><p class="detail-note">零報酬、無交易不算正報酬。所有幣種均有完整結果才會顯示「是」。示範資料僅供練習；歷史結果不代表未來。</p>`;
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
  $('#plain-summary').innerHTML = `<div class="plain-strategy"><span class="plain-kicker">這次系統選到的交易方法</span><h3>${esc(plain.name)}</h3><small>原技術名稱：${esc(plain.technical)} · ${esc(plain.indicators)}</small><p><b>怎麼買、怎麼賣：</b>${esc(plain.rule)}</p></div><div class="plain-result"><strong class="${color(s.totalReturn)}">${s.totalReturn >= 0 ? '這次回測有獲利' : '這次回測是虧損'} ${pct(s.totalReturn)}</strong><span>假設 ${num(result.options.capital)} ${result.metadata.quote} → ${num(s.endValue)} ${result.metadata.quote}</span><span>過程中從高點最多曾回落 ${num(s.maxDrawdown)}%</span><em>這只是歷史資料模擬，不代表之後一定會有相同結果。</em></div>`;
  $('#chart-caption').textContent = `${plain.name} · ${source === 'synthetic' ? '練習用示範資料' : 'Binance 歷史資料'} · ${state.range === 'test' ? '最後 30% 資料另外測試' : '整段歷史資料'}`;
  if (combo) $('#plain-summary .plain-kicker').textContent = '你勾選的 AND 進場條件';
  $('#chart-unit').textContent = result.metadata.quote;
  $('#period-label').textContent = `${date(report.equity[0].time)} — ${date(report.equity.at(-1).time)} UTC`;
  $('#drawdown-max').textContent = `${num(s.maxDrawdown)}%`;
  $('#detail-range-label').textContent = state.range === 'test' ? '樣本外期間' : '完整期間';
  $$('[data-range]').forEach(b => b.classList.toggle('active', b.dataset.range === state.range));
  equityChart($('#equity-chart'), report); drawdownChart($('#drawdown-chart'), report.equity); renderCandlestick();
  $('#candidate-count').textContent = result.ranking.length;
  $('#ranking-body').innerHTML = result.ranking.map((r, i) => { const p = beginnerStrategy(r.strategy); return `<tr><td><span class="rank-number ${i === 0 ? 'winner' : ''}">${String(i + 1).padStart(2, '0')}</span><span class="strategy-name">${esc(p.name)}</span>${i === 0 ? '<span class="best-pill">前段表現最好</span>' : ''}<span class="strategy-sub">${esc(p.rule)}</span></td><td class="mono ${color(r.train.totalReturn)}">${pct(r.train.totalReturn)}</td><td class="mono ${color(r.test.totalReturn)}">${pct(r.test.totalReturn)}</td><td class="mono negative">${num(r.test.maxDrawdown)}%</td><td class="mono">${r.test.trades}</td></tr>`; }).join('');
  const top = result.ranking[0], topPlain = beginnerStrategy(top.strategy);
  $('#ranking-insight').innerHTML = `✧ 前 70% 資料裡，<strong>${esc(topPlain.name)}</strong> 表現最好；拿最後 30% 沒參與挑選的資料再測，結果是 <strong>${pct(top.test.totalReturn)}</strong>。${top.train.trades < 3 || top.train.sharpe === null ? ' 但交易次數太少，先不要把這個結果看得太重。' : ''}${top.test.totalReturn > 0 ? ' 後段仍為正報酬，但還要一起看最慘跌幅與交易次數。' : ' 後段變成虧損，表示前段好成績沒有穩定延續。'}${source === 'synthetic' ? ' 目前是練習資料，不能拿來判斷真實市場。' : ''}`;
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
  const config = { version: 1, market: state.market, symbols: state.symbols, quote: state.quote, values, optimize: $('#optimize').checked, rules: readRules(), combination: readCombination() };
  try { localStorage.setItem('quantlab-config-v1', JSON.stringify(config)); toast('設定已儲存在此瀏覽器'); } catch { toast('此瀏覽器不允許本機儲存'); }
}
async function loadConfig() {
  if (state.running) return;
  try {
    const config = JSON.parse(localStorage.getItem('quantlab-config-v1'));
    if (!config || config.version !== 1) return toast('尚無已儲存的設定');
    await switchMarket(config.market);
    for (const [name, value] of Object.entries(config.values)) { const element = $('#config-form').elements.namedItem(name); if (element && element.type !== 'checkbox') element.value = value; }
    state.symbols = config.symbols.slice(0, MAX_SYMBOLS); state.quote = config.quote; $('#optimize').checked = config.optimize;
    initRules(config.rules); initCombination(config.combination); strategyChanged(); renderSymbols(); await sourceChanged(); toast('已載入設定，執行回測即可更新結果');
  } catch { toast('儲存的設定無法讀取'); }
}
function initContent() {
  $('#help-button').title = '新手回測教學'; $('#help-button').setAttribute('aria-label', '新手回測教學');
  $('#strategy').insertAdjacentHTML('beforeend', '<option value="combination">✓ 條件組合回測（勾選條件，全部符合）</option>');
  $('#selected-symbols').insertAdjacentHTML('afterend', `<div class="symbol-picker-actions"><button type="button" class="secondary" id="open-symbol-picker">☰ 點選幣種</button><span id="symbol-picker-count">已選 ${state.symbols.length} / ${MAX_SYMBOLS}</span></div><div class="mover-shortcuts"><span>Binance 合約 24h 快速選取</span><button type="button" data-mover-preset="gainers10">漲幅前 10</button><button type="button" data-mover-preset="gainers15">漲幅前 15</button><button type="button" data-mover-preset="losers10">跌幅前 10</button><button type="button" data-mover-preset="losers15">跌幅前 15</button><small>會自動切換到 Binance 真實行情＋USDT 永續合約，並取代目前選取。</small></div><dialog id="symbol-picker-dialog" class="symbol-picker-dialog"><div class="symbol-picker-head"><div><h3>點選回測幣種</h3><p>直接點選，不用輸入代碼。最多 ${MAX_SYMBOLS} 個。</p></div><button type="button" id="close-symbol-picker" aria-label="關閉">×</button></div><input id="symbol-picker-search" type="search" placeholder="搜尋 BTC、ETH、SOL…"><div class="symbol-picker-toolbar"><span id="symbol-picker-count-modal"></span><button type="button" id="clear-symbols">清除全部</button></div><div id="symbol-checkboxes" class="symbol-picker-list"></div><div class="symbol-picker-foot"><button type="button" class="primary" id="done-symbol-picker">完成選擇</button></div></dialog>`);
  $('#plain-summary').insertAdjacentHTML('beforebegin', '<section id="combination-results" class="panel hidden" aria-label="條件組合逐幣結果"></section>');
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
  if (el.dataset.view) view(el.dataset.view);
  if (el.dataset.tutorialPreset) applyTutorialPreset(el.dataset.tutorialPreset).catch(e => notice(e.message));
  if (el.matches('.brand')) view('workbench');
  if (el.id === 'help-button') view('tutorial');
  if (el.dataset.market) switchMarket(el.dataset.market);
  if (el.id === 'open-symbol-picker') { renderSymbolCheckboxes(); const dialog = $('#symbol-picker-dialog'); if (dialog?.showModal) dialog.showModal(); else if (dialog) dialog.setAttribute('open', ''); }
  if (el.id === 'close-symbol-picker' || el.id === 'done-symbol-picker') { const dialog = $('#symbol-picker-dialog'); if (dialog?.close) dialog.close(); else dialog?.removeAttribute('open'); }
  if (el.id === 'clear-symbols') { if (!state.running) { state.symbols = []; renderSymbols(); markDirty(); } }
  if (el.dataset.moverPreset) applyFuturesMoverPreset(el.dataset.moverPreset);
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
const initialView = location.hash.slice(1); if (['workbench', 'tutorial', 'markets', 'strategies', 'method'].includes(initialView)) view(initialView);
else if (initialView.startsWith('tutorial-') && document.getElementById(initialView)) { view('tutorial'); document.getElementById(initialView).scrollIntoView(); }
await refreshMarkets();
runBacktest();
