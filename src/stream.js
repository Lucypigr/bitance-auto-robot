// One upstream socket per market, shared by browsers through same-origin SSE.
// Native WebSocket respects the Node --use-env-proxy dispatcher in this environment.
export function createMarketStream(socketFactory = url => new WebSocket(url)) {
  const groups = new Map();
  const destinations = { spot: 'wss://data-stream.binance.vision/ws/!miniTicker@arr', futures: 'wss://fstream.binance.com/ws/!miniTicker@arr' };
  function broadcast(group, message, event) {
    const frame = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(message)}\n\n`;
    for (const res of group.clients) {
      if (res.destroyed || res.writableLength > 1024 * 1024) { res.destroy(); continue; }
      res.write(frame);
    }
  }
  function open(group) {
    if (!group.clients.size || group.socket) return;
    const socket = socketFactory(destinations[group.market]); group.socket = socket;
    broadcast(group, { state: 'connecting' }, 'status');
    socket.addEventListener('message', event => {
      if (group.socket !== socket) return;
      try {
        const rows = JSON.parse(event.data);
        if (Array.isArray(rows)) broadcast(group, rows);
      } catch { /* Keep the last valid quotes; malformed frames are not forwarded. */ }
    });
    const disconnected = () => {
      if (group.socket !== socket) return;
      group.socket = null; socket.close();
      broadcast(group, { state: 'fallback' }, 'status');
      if (group.clients.size) { clearTimeout(group.retry); group.retry = setTimeout(() => open(group), 15000); group.retry.unref(); }
    };
    socket.addEventListener('close', disconnected);
    socket.addEventListener('error', disconnected);
  }
  function release(group) {
    clearTimeout(group.retry); clearInterval(group.heartbeat);
    const socket = group.socket; group.socket = null; socket?.close(); if (groups.get(group.market) === group) groups.delete(group.market);
  }
  return {
    subscribe(market, res) {
      let group = groups.get(market);
      if (!group) {
        group = { market, clients: new Set(), socket: null, retry: null, heartbeat: null };
        group.heartbeat = setInterval(() => { for (const client of group.clients) client.write(': heartbeat\n\n'); }, 20000);
        group.heartbeat.unref(); groups.set(market, group);
      }
      if (group.clients.size >= 100) { res.writeHead(429); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 15000\n\n');
      group.clients.add(res);
      res.on('close', () => { group.clients.delete(res); if (!group.clients.size) release(group); });
      open(group);
    },
    close() {
      for (const group of groups.values()) { for (const client of group.clients) client.end(); release(group); }
    },
  };
}
