import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const base = resolve(import.meta.dirname, '../docs');
const prefix = '/bitance-auto-robot/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404); return res.end(); }
    const name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const path = resolve(base, name);
    if (!path.startsWith(base + '/') || !mime[extname(path)]) { res.writeHead(404); return res.end(); }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(Number(process.env.PORT ?? 4173), '127.0.0.1');
