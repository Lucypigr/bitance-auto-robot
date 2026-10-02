import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { parseHistoryQuery } from '../src/binance.js';
test('HTTP application serves UI, isolated demo APIs and rejects unsafe requests', async t => {
  const server=createApp(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const health=await fetch(`${base}/api/health`); assert.equal((await health.json()).status,'ok');
  const page=await fetch(base); assert.match(await page.text(),/QuantLab/); assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const markets=await (await fetch(`${base}/api/markets?demo=1`)).json(); assert.equal(markets.source,'synthetic'); assert.equal(markets.markets.length,16);
  const start=Date.UTC(2025,0,1),end=Date.UTC(2025,0,10);
  const history=await (await fetch(`${base}/api/history?demo=1&market=futures&symbol=BTCUSDT&interval=1h&start=${start}&end=${end}`)).json();
  assert.equal(history.source,'synthetic'); assert.ok(history.candles.length>220); assert.ok(history.funding.length>0); assert.ok(history.candles[0].markClose>0);
  assert.equal((await fetch(`${base}/api/history?interval=__proto__`)).status,400);
  assert.equal((await fetch(`${base}/api/markets?market=bad`)).status,400);
  assert.equal((await fetch(`${base}/src/server.js`)).status,404);
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status,404);
  assert.equal((await fetch(`${base}/api/health`,{method:'POST'})).status,405);
});
test('history query caps workload, validates time and rejects unsupported futures intervals',()=>{
  const now=Date.UTC(2025,0,10),start=Date.UTC(2025,0,1);
  const good=new URLSearchParams({symbol:'BTCUSDT',market:'spot',interval:'1h',start,end:now});
  assert.equal(parseHistoryQuery(good).symbol,'BTCUSDT');
  for(const [key,value] of [['interval','constructor'],['symbol','../../etc'],['start','NaN'],['end','Infinity']]){const q=new URLSearchParams(good);q.set(key,value);assert.throws(()=>parseHistoryQuery(q));}
  const tooLong=new URLSearchParams({symbol:'BTCUSDT',market:'spot',interval:'5m',start:Date.UTC(2018,0,1),end:now});
  assert.throws(()=>parseHistoryQuery(tooLong));
});
test('realtime SSE shares one upstream WebSocket and forwards quote frames',async t=>{
  let created=0,closed=0;
  class FakeSocket extends EventTarget {
    constructor(){super();created++;setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify([{s:'BTCUSDT',c:'123',o:'100',h:'125',l:'99',q:'1000'}])})),50);}
    close(){closed++;this.dispatchEvent(new Event('close'));}
  }
  const server=createApp({socketFactory:()=>new FakeSocket()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const endpoint=`http://127.0.0.1:${server.address().port}/api/stream?market=spot`;
  const responses=await Promise.all([fetch(endpoint),fetch(endpoint)]);
  for(const response of responses){
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const reader=response.body.getReader();let text='';
    while(!text.includes('BTCUSDT')){const{value,done}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);}
    assert.match(text,/"c":"123"/);await reader.cancel();
  }
  assert.equal(created,1);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,1);
});
