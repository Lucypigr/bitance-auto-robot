import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { getMarkets, getHistory, parseHistoryQuery, DataError } from './binance.js';
import { demoMarkets, demoHistory } from './demo.js';
import { createMarketStream } from './stream.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const publicModules = new Set(['backtest.js', 'combination.js', 'indicators.js', 'strategies.js', 'demo.js', 'binance.js']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export function createApp({ socketFactory } = {}) {
  const streams = createMarketStream(socketFactory);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://data-stream.binance.vision wss://fstream.binance.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'GET') return json({ error: '僅支援 GET' }, 405);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return json({ status: 'ok', version: '1.0.0', trading: false });
      if (url.pathname === '/api/stream') {
        const market = url.searchParams.get('market') ?? 'spot';
        if (!['spot', 'futures'].includes(market)) throw new DataError('市場無效', 400);
        return streams.subscribe(market, res);
      }
      if (url.pathname === '/api/markets') {
        const market = url.searchParams.get('market') ?? 'spot';
        if (!['spot', 'futures'].includes(market)) throw new DataError('市場無效', 400);
        return json(url.searchParams.get('demo') === '1' ? { markets: demoMarkets(), source: 'synthetic', market, fetchedAt: new Date().toISOString() } : await getMarkets(market));
      }
      if (url.pathname === '/api/history') {
        const q = parseHistoryQuery(url.searchParams);
        return json(url.searchParams.get('demo') === '1' ? demoHistory(q.symbol, q.interval, q.startTime, q.endTime, q.market) : await getHistory(q));
      }
      if (url.pathname.startsWith('/api/')) return json({ error: '找不到 API' }, 404);
      const name = decodeURIComponent(url.pathname);
      const isModule = name.startsWith('/src/') && publicModules.has(name.slice(5));
      const base = resolve(root, isModule ? 'src' : 'public');
      const path = resolve(base, isModule ? name.slice(5) : name === '/' ? 'index.html' : `.${name}`);
      if (!path.startsWith(base + (process.platform === 'win32' ? '\\' : '/')) || !mime[extname(path)]) return json({ error: '找不到檔案' }, 404);
      const data = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-cache' }); res.end(data);
    } catch (e) {
      if (res.headersSent) return res.end();
      const status = e.code === 'ENOENT' ? 404 : e instanceof DataError ? e.status : 500;
      json({ error: status === 500 ? '伺服器無法處理此請求' : e.message }, status);
    }
  });
  server.on('close', () => streams.close());
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '0.0.0.0';
  createApp().listen(port, host, () => console.log(`Quant Lab listening on ${host}:${port}`));
}
