import { test, expect } from '@playwright/test';
const origin='https://data-api.binance.vision';
test('GitHub Pages artifact loads from repository subpath and runs demo in a Worker',async({page})=>{
  const errors=[],apiCalls=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))apiCalls.push(r.url());});
  await page.goto('./');
  await expect(page.locator('#progress')).toContainText('已完成',{timeout:30000});
  await expect(page.locator('#ranking-body tr')).toHaveCount(24);
  await expect(page.locator('#equity-chart svg')).toBeVisible();
  await expect(page.locator('#report-state')).toContainText('合成示範');
  expect(apiCalls).toEqual([]);expect(errors).toEqual([]);
});
test('static site fetches public Binance data directly and runs historical backtest',async({page})=>{
  const localApi=[];
  page.on('request',r=>{if(r.url().startsWith('http://127.0.0.1:4173/api/'))localApi.push(r.url());});
  await page.route(`${origin}/**`,async route=>{
    const url=new URL(route.request().url());
    let body;
    if(url.pathname.endsWith('/exchangeInfo'))body={symbols:[{symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true}]};
    else if(url.pathname.endsWith('/ticker/24hr'))body=[{symbol:'BTCUSDT',lastPrice:'118',openPrice:'100',priceChangePercent:'18',quoteVolume:'3000000',highPrice:'120',lowPrice:'95'}];
    else if(url.pathname.endsWith('/klines')){
      const start=Number(url.searchParams.get('startTime')),end=Number(url.searchParams.get('endTime')),step=3600000;
      body=[];
      for(let time=start;time<=end&&body.length<1000;time+=step){const p=100+8*Math.sin(time/step/30);body.push([time,String(p),String(p*1.01),String(p*.99),String(p*(1+.002*Math.sin(time/step))),String(200+Math.abs(Math.sin(time/step))*100),time+step-1]);}
    }else throw new Error(`Unexpected Binance path ${url.pathname}`);
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  });
  await page.routeWebSocket('wss://data-stream.binance.vision/**',socket=>socket.send(JSON.stringify([{s:'BTCUSDT',c:'123.45',o:'100',h:'125',l:'99',q:'1000'}])));
  await page.goto('./');
  await expect(page.locator('#progress')).toContainText('已完成',{timeout:30000});
  await page.locator('#source').selectOption('live');
  await expect(page.locator('#market-count')).toContainText('1 個交易對');
  await expect(page.locator('#connection-badge')).toContainText('即時串流',{timeout:15000});
  await expect(page.locator('.ticker-price').first()).toContainText('123.45');
  await page.locator('#run-button').click();
  await expect(page.locator('#report-state')).toContainText('幣安資料',{timeout:45000});
  await expect(page.locator('#ranking-body tr')).toHaveCount(24);
  expect(localApi).toEqual([]);
});
test('static live data error is explicit and does not relabel demo report',async({page})=>{
  await page.route(`${origin}/**`,route=>route.fulfill({status:451,contentType:'application/json',body:'{"code":-1,"msg":"Unavailable for legal reasons"}'}));
  await page.goto('./');await expect(page.locator('#progress')).toContainText('已完成',{timeout:30000});
  await page.locator('#source').selectOption('live');
  await expect(page.locator('#notice')).toContainText('HTTP 451');
  await expect(page.locator('#connection-badge')).toContainText('連線失敗');
  await expect(page.locator('#report-state')).toContainText('示範結果');
});

test('futures mover shortcut selects top 15 from Binance 24h ranking',async({page})=>{
  const contracts=Array.from({length:18},(_,i)=>({symbol:`COIN${String(i+1).padStart(2,'0')}USDT`,baseAsset:`COIN${String(i+1).padStart(2,'0')}`,quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'}));
  await page.route('https://fapi.binance.com/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/exchangeInfo')) return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({symbols:contracts})});
    if(url.pathname.endsWith('/ticker/24hr')) return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(contracts.map((c,i)=>({symbol:c.symbol,lastPrice:String(100+i),priceChangePercent:String(i-9),quoteVolume:String(1000000+i),highPrice:'150',lowPrice:'50'})))});
    throw new Error(`Unexpected futures path ${url.pathname}`);
  });
  await page.routeWebSocket('wss://fstream.binance.com/**',socket=>socket.send('[]'));
  await page.goto('./');
  await expect(page.locator('#progress')).toContainText('已完成',{timeout:30000});
  await page.locator('[data-mover-preset="gainers15"]').click();
  await expect(page.locator('#source')).toHaveValue('live');
  await expect(page.locator('[data-market="futures"]')).toHaveClass(/active/);
  await expect(page.locator('.symbol-chip')).toHaveCount(15,{timeout:15000});
  await expect(page.locator('.symbol-chip').first()).toContainText('COIN18USDT');
  await expect(page.locator('#symbol-picker-count')).toContainText('15 / 15');
});
