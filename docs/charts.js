const n = (v, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v);
const date = time => new Date(time).toISOString().slice(0, 10);
export function equityChart(container, report) {
  const { equity, benchmark } = report;
  if (!equity.length) { container.textContent = '無資料'; return; }
  const width = 850, height = 270, left = 12, right = 74, top = 16, bottom = 32;
  const values = equity.flatMap((p, i) => [p.value, benchmark[i].value]);
  let min = Infinity, max = -Infinity;
  for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
  const padding = (max - min) * .12 || max * .03 || 1; min -= padding; max += padding;
  const x = i => left + i / Math.max(1, equity.length - 1) * (width - left - right);
  const y = v => top + (max - v) / (max - min) * (height - top - bottom);
  const step = Math.max(1, Math.floor(equity.length / 700));
  const indices = equity.map((_, i) => i).filter(i => i % step === 0 || i === equity.length - 1);
  const path = series => indices.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(2)},${y(series[i].value).toFixed(2)}`).join(' ');
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = min + (max - min) * i / 4;
    return `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#27303b" stroke-dasharray="3 5"/><text x="${width - right + 13}" y="${y(value) + 4}" fill="#748195" font-size="10" font-family="monospace">${n(value)}</text>`;
  }).join('');
  const labels = Array.from({ length: 5 }, (_, i) => {
    const index = Math.round((equity.length - 1) * i / 4);
    return `<text x="${x(index)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" fill="#6d7b90" font-size="9" font-family="monospace">${date(equity[index].time)}</text>`;
  }).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="策略淨值與買入持有基準比較"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c5ed79" stop-opacity=".18"/><stop offset="100%" stop-color="#c5ed79" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${path(equity)} L${x(equity.length - 1)},${height - bottom} L${left},${height - bottom} Z" fill="url(#areaGradient)"/><path d="${path(benchmark)}" fill="none" stroke="#657891" stroke-width="1.5" stroke-dasharray="5 4"/><path d="${path(equity)}" fill="none" stroke="#d6f78b" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${x(equity.length - 1)}" cy="${y(equity.at(-1).value)}" r="3" fill="#d6f78b"/>${labels}<line id="crosshair" y1="${top}" y2="${height - bottom}" stroke="#a1b286" stroke-dasharray="3 4" visibility="hidden"/></svg><div class="chart-tooltip hidden"></div>`;
  const tooltip = container.querySelector('.chart-tooltip'), crosshair = container.querySelector('#crosshair');
  container.onpointermove = event => {
    const bounds = container.getBoundingClientRect(), sx = (event.clientX - bounds.left) / bounds.width * width;
    const index = Math.max(0, Math.min(equity.length - 1, Math.round((sx - left) / (width - left - right) * (equity.length - 1))));
    const p = equity[index];
    tooltip.innerHTML = `${new Date(p.time).toISOString().slice(0, 16).replace('T', ' ')} UTC<br>策略 <b>${n(p.value, 2)}</b><br>持有 ${n(benchmark[index].value, 2)}`;
    tooltip.classList.remove('hidden'); tooltip.style.left = `${Math.max(0, Math.min(bounds.width - 200, event.clientX - bounds.left + 12))}px`;
    crosshair.setAttribute('x1', x(index)); crosshair.setAttribute('x2', x(index)); crosshair.setAttribute('visibility', 'visible');
  };
  container.onpointerleave = () => { tooltip.classList.add('hidden'); crosshair.setAttribute('visibility', 'hidden'); };
}
export function drawdownChart(container, equity) {
  const width = 850, height = 60, right = 74;
  const maxDD = Math.max(1, ...equity.map(p => -p.drawdown));
  const step = Math.max(1, Math.floor(equity.length / 650));
  const sampled = [];
  for (let i = 0; i < equity.length; i += step) sampled.push({ index: i, value: Math.min(...equity.slice(i, i + step).map(p => p.drawdown)) });
  const path = sampled.map((p, i) => `${i ? 'L' : 'M'}${12 + p.index / Math.max(1, equity.length - 1) * (width - right - 12)},${7 + (-p.value / maxDD) * 39}`).join(' ');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="回撤百分比"><line x1="12" x2="${width - right}" y1="7" y2="7" stroke="#303240"/><path d="M12,7 ${path.replace(/^M/, 'L')} L${width - right},7 Z" fill="#e7808b" fill-opacity=".13"/><path d="${path}" fill="none" stroke="#ca7782" stroke-width="1"/><text x="${width - right + 13}" y="15" fill="#7c889a" font-size="9" font-family="monospace">0%</text><text x="${width - right + 13}" y="49" fill="#7c889a" font-size="9" font-family="monospace">−${maxDD.toFixed(1)}%</text></svg>`;
}

const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function candlestickChart(container, candles, markers = []) {
  if (!candles?.length) { container.innerHTML = '<div class="chart-empty">這一段沒有 K 線資料</div>'; return; }
  const width = 900, height = 330, left = 14, right = 78, top = 24, bottom = 30;
  let min = Math.min(...candles.map(c => c.low)), max = Math.max(...candles.map(c => c.high));
  const pad = (max - min) * .08 || max * .01 || 1; min -= pad; max += pad;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = i => left + (i + .5) / candles.length * plotW;
  const y = v => top + (max - v) / (max - min) * plotH;
  const candleW = Math.max(1.2, Math.min(8, plotW / candles.length * .62));
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = max - (max - min) * i / 4;
    return `<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="#27303b" stroke-dasharray="3 5"/><text x="${width-right+9}" y="${y(value)+4}" fill="#748195" font-size="9" font-family="monospace">${n(value, value < 1 ? 5 : value < 100 ? 3 : 2)}</text>`;
  }).join('');
  const bodies = candles.map((c, i) => {
    const up = c.close >= c.open, color = up ? '#66d7a5' : '#f38c95', cx = x(i);
    const oy = y(c.open), cy = y(c.close), bodyY = Math.min(oy, cy), bodyH = Math.max(1, Math.abs(cy - oy));
    return `<g data-candle="${i}"><line x1="${cx}" x2="${cx}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}" stroke-width="1"/><rect x="${cx-candleW/2}" y="${bodyY}" width="${candleW}" height="${bodyH}" rx=".5" fill="${up ? '#254f42' : '#5a3038'}" stroke="${color}" stroke-width=".8"/></g>`;
  }).join('');
  const step = candles.length > 1 ? candles[1].time - candles[0].time : 1;
  const buckets = Array.from({ length: candles.length }, () => []);
  for (const marker of markers) {
    const idx = Math.floor((marker.time - candles[0].time) / step);
    if (idx >= 0 && idx < candles.length) buckets[idx].push(marker);
  }
  const markerSvg = buckets.flatMap((items, i) => items.slice(0, 4).map((m, j) => {
    const cx = x(i), c = candles[i];
    if (m.kind === 'entry') {
      const bullish = m.side === 'long', yy = bullish ? y(c.low) + 13 + j * 11 : y(c.high) - 13 - j * 11;
      return bullish
        ? `<path d="M${cx-5},${yy+6} L${cx},${yy-2} L${cx+5},${yy+6} Z" fill="#66d7a5"><title>${html(m.label)}</title></path>`
        : `<path d="M${cx-5},${yy-6} L${cx},${yy+2} L${cx+5},${yy-6} Z" fill="#f38c95"><title>${html(m.label)}</title></path>`;
    }
    if (m.kind === 'exit') {
      const yy = y(c.close) - 14 - j * 11;
      return `<g><circle cx="${cx}" cy="${yy}" r="4.2" fill="#a9b4c4" stroke="#111820"/><path d="M${cx-2.3},${yy-2.3} L${cx+2.3},${yy+2.3} M${cx+2.3},${yy-2.3} L${cx-2.3},${yy+2.3}" stroke="#111820" stroke-width="1"><title>${html(m.label)}</title></path></g>`;
    }
    if (m.kind === 'signal') {
      const yy = y(c.high) - 16 - j * 11;
      return `<g><path d="M${cx},${yy-5} L${cx+5},${yy} L${cx},${yy+5} L${cx-5},${yy} Z" fill="#e5b977"/><title>${html(m.label)}</title></g>`;
    }
    const bullish = m.bias === 'bullish', bearish = m.bias === 'bearish';
    const fill = bullish ? '#66d7a5' : bearish ? '#f38c95' : '#aeb8c8';
    const yy = bullish ? y(c.low) + 18 + j * 11 : y(c.high) - 18 - j * 11;
    const textY = yy + 3;
    return `<g><rect x="${cx-12}" y="${yy-7}" width="24" height="12" rx="3" fill="${fill}" fill-opacity=".92"/><text x="${cx}" y="${textY}" text-anchor="middle" fill="#10151b" font-size="7" font-weight="700">${html(m.short ?? '型態')}</text><title>${html(m.label)}</title></g>`;
  })).join('');
  const labels = Array.from({ length: 5 }, (_, i) => {
    const index = Math.min(candles.length - 1, Math.round((candles.length - 1) * i / 4));
    return `<text x="${x(index)}" y="${height-7}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" fill="#6d7b90" font-size="9" font-family="monospace">${date(candles[index].time)}</text>`;
  }).join('');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="K 線與回測訊號">${grid}${bodies}${markerSvg}${labels}<line id="candle-crosshair" y1="${top}" y2="${height-bottom}" stroke="#a1b286" stroke-dasharray="3 4" visibility="hidden"/></svg><div class="chart-tooltip hidden"></div>`;
  const tooltip = container.querySelector('.chart-tooltip'), crosshair = container.querySelector('#candle-crosshair');
  const show = event => {
    const bounds = container.getBoundingClientRect(), sx = (event.clientX - bounds.left) / bounds.width * width;
    const index = Math.max(0, Math.min(candles.length - 1, Math.floor((sx - left) / plotW * candles.length)));
    const c = candles[index], notes = buckets[index];
    tooltip.innerHTML = `${new Date(c.time).toISOString().slice(0,16).replace('T',' ')} UTC<br>O <b>${n(c.open, 6)}</b>　H ${n(c.high, 6)}<br>L ${n(c.low, 6)}　C <b>${n(c.close, 6)}</b>${notes.length ? '<br><span class="tooltip-notes">'+notes.map(m=>html(m.label)).join('<br>')+'</span>' : ''}`;
    tooltip.classList.remove('hidden'); tooltip.style.left = `${Math.max(0, Math.min(bounds.width - 245, event.clientX - bounds.left + 12))}px`;
    crosshair.setAttribute('x1', x(index)); crosshair.setAttribute('x2', x(index)); crosshair.setAttribute('visibility', 'visible');
  };
  container.onpointermove = show;
  container.onpointerdown = show;
  container.onpointerleave = () => { tooltip.classList.add('hidden'); crosshair.setAttribute('visibility', 'hidden'); };
}
