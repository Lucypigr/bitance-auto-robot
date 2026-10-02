import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarkets, getHistory } from '../src/binance.js';
const step=3600000, start=Date.UTC(2025,0,1), end=start+1005*step;
const rawRow=t=>[t,'100','105','95','102','20',t+step-1,'2040',10,'1','100','0'];
test('spot adapter paginates beyond 1000 bars and preserves actual source and UTC coverage',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);calls.push(url);
    if(url.pathname.endsWith('exchangeInfo')) return Response.json({symbols:[{symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true}]});
    if(url.pathname.endsWith('ticker/24hr')) return Response.json([{symbol:'BTCUSDT',lastPrice:'100',priceChangePercent:'2',quoteVolume:'5000',highPrice:'102',lowPrice:'95'}]);
    const from=Number(url.searchParams.get('startTime'));
    return Response.json(Array.from({length:Math.min(1000,(end-from)/step)},(_,i)=>rawRow(from+i*step)));
  });
  const market=await getMarkets('spot');assert.equal(market.markets[0].quote,'USDT');
  const history=await getHistory({market:'spot',symbol:'BTCUSDT',interval:'1h',startTime:start,endTime:end});
  assert.equal(history.candles.length,1225);assert.equal(history.candles[0].time,start-220*step);assert.equal(history.candles.at(-1).time,end-step);
  assert.equal(history.source,'binance');assert.equal(calls.filter(u=>u.pathname.endsWith('/klines')).length,2);
  assert.ok(calls.every(u=>u.origin==='https://data-api.binance.vision'));
});
test('futures adapter loads independent marks and signed funding events',async t=>{
  const shortEnd=start+20*step;
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);
    if(url.pathname.endsWith('exchangeInfo'))return Response.json({symbols:[{symbol:'ETHUSDT',baseAsset:'ETH',quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'}]});
    if(url.pathname.endsWith('ticker/24hr'))return Response.json([{symbol:'ETHUSDT',lastPrice:'100'}]);
    if(url.pathname.endsWith('fundingRate'))return Response.json(Number(url.searchParams.get('startTime'))>start?[]:[{fundingTime:start,fundingRate:'-0.0001',markPrice:'101'}]);
    const from=Number(url.searchParams.get('startTime'));
    return Response.json(Array.from({length:Math.min(1000,(shortEnd-from)/step)},(_,i)=>{
      const row=rawRow(from+i*step);if(url.pathname.endsWith('markPriceKlines'))row[4]='101';return row;
    }));
  });
  const history=await getHistory({market:'futures',symbol:'ETHUSDT',interval:'1h',startTime:start,endTime:shortEnd});
  assert.equal(history.candles[0].close,102);assert.equal(history.candles[0].markClose,101);assert.equal(history.funding[0].rate,-.0001);
});
