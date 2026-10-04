import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, analyze, validateOptions, validateCandles, metrics } from '../src/backtest.js';
import { validateRules, candidates } from '../src/strategies.js';
import { demoHistory } from '../src/demo.js';
const hour = 3600000;
const options = { market:'spot', interval:'1h', capital:10000, fee:0, slippage:0, allocation:1, leverage:1, stopLoss:0, takeProfit:0, trailingStop:0, maintenance:.005, strategy:'auto', optimize:false, startTime:Date.UTC(2025,0,1) };
const empty = () => ({long:false,short:false,exitLong:false,exitShort:false});
const bars = (prices) => prices.map((p,i) => ({time:Date.UTC(2025,0,1)+i*hour,open:p,high:p,low:p,close:p,volume:100,markOpen:p,markHigh:p,markLow:p,markClose:p}));
function run(candles, opts = {}, entries = {}) {
  const signals = candles.map(() => empty());
  for (const [index, signal] of Object.entries(entries)) Object.assign(signals[index], signal);
  return simulate({symbol:'BTCUSDT',candles,funding:opts.funding??[]}, {id:'rsi',params:{low:30,high:70}}, {...options,...opts}, {start:1,end:candles.length}, signals);
}
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
test('signals execute at NEXT open, final account reconciles with net trade PnL', () => {
  const result = run(bars([50,100,110,120]), {}, {0:{long:true},2:{exitLong:true}});
  assert.equal(result.trades[0].entry,100); assert.equal(result.trades[0].exit,120);
  near(result.stats.endValue,12000); near(result.stats.netProfit,result.trades.reduce((s,t)=>s+t.pnl,0));
});
test('entry/exit fee and adverse slippage charged once on both legs', () => {
  const result = run(bars([100,100,110]), {fee:.001,slippage:.01}, {0:{long:true}});
  const qty = 10000/(101*1.001), expected = qty*108.9*.999;
  near(result.stats.endValue,expected);
  near(result.trades[0].fees,qty*(101+108.9)*.001);
  near(result.trades[0].slippageCost,qty*(1+1.1));
});
test('same-bar stop and target uses conservative stop; gap executes at worse open', () => {
  const c=bars([100,100,100]); c[1].high=120; c[1].low=80;
  const result=run(c,{stopLoss:.1,takeProfit:.1},{0:{long:true}});
  assert.equal(result.trades[0].reason,'stop'); near(result.stats.endValue,9000);
  const gap=run(bars([100,100,70]),{stopLoss:.1},{0:{long:true}});
  assert.equal(gap.trades[0].exit,70); near(gap.stats.endValue,7000);
});
test('short sells with adverse fills and receives positive funding', () => {
  const c=bars([100,100,90]);
  const result=run(c,{market:'futures',leverage:2,fee:.001,slippage:.01,funding:[{time:c[2].time,rate:.001,markPrice:90}]},{0:{short:true}});
  const t=result.trades[0];
  assert.equal(t.entry,99); near(t.exit,90.9); assert.ok(t.funding<0);
  near(result.stats.endValue,10000+t.pnl);
});
test('funding is paid by carried positions, not a new entry on funding bar', () => {
  const c=bars([100,100,100]);
  const result=run(c,{market:'futures',funding:[{time:c[1].time,rate:.1,markPrice:100},{time:c[2].time,rate:.001,markPrice:100}]},{0:{long:true}});
  near(result.stats.funding,10); near(result.stats.endValue,9990);
});
test('futures liquidation uses mark price and preserves unallocated wallet', () => {
  const c=bars([100,100,100]); c[2].markLow=70;
  const result=run(c,{market:'futures',leverage:5,allocation:.5},{0:{long:true}});
  assert.equal(result.trades[0].reason,'liquidation'); near(result.stats.endValue,5000); near(result.trades[0].pnl,-5000);
});
test('spot cannot short and trailing stop becomes active only next bar', () => {
  assert.equal(run(bars([100,100,90]),{}, {0:{short:true}}).stats.trades,0);
  const c=bars([100,100,120]); Object.assign(c[1],{high:130,low:100,close:120}); Object.assign(c[2],{low:107,close:115});
  const result=run(c,{trailingStop:.1},{0:{long:true}});
  assert.equal(result.trades[0].exitTime,c[2].time+hour-1); near(result.trades[0].exit,108);
});
test('invalid settings, malformed candles and arbitrary rule code rejected', () => {
  assert.doesNotThrow(()=>validateOptions({...options,capital:5}));
  assert.throws(()=>validateOptions({...options,capital:4.99}));
  assert.throws(()=>validateOptions({...options,leverage:2}));
  assert.throws(()=>validateOptions({...options,market:'futures',interval:'1d'}));
  assert.throws(()=>validateCandles(bars([100,100]).map((c,i)=>({...c,time:c.time+i})),hour));
  assert.throws(()=>validateRules({entryLong:[{left:'process.exit()',op:'>',right:0}],exitLong:[],entryShort:[],exitShort:[]}));
  assert.equal(candidates('auto',true).length,24);
});
test('held-out data changes cannot influence training scores or selection', () => {
  const data=demoHistory('BTCUSDT','1h',Date.UTC(2025,0,1),Date.UTC(2025,0,16));
  const first=analyze([data],options);
  const modified=structuredClone(data);
  for(const c of modified.candles) if(c.time>=first.metadata.split) for(const key of ['open','high','low','close']) c[key]*=2;
  const second=analyze([modified],options);
  assert.deepEqual(first.ranking.map(r=>[r.strategy.id,r.score,r.train]),second.ranking.map(r=>[r.strategy.id,r.score,r.train]));
  assert.deepEqual(first.best,second.best);
  assert.equal(first.test.equity[0].time,first.metadata.split);
});
test('portfolio is equal-capital independent accounts; all cash and costs reconcile', () => {
  const data=demoHistory('BTCUSDT','1h',Date.UTC(2025,0,1),Date.UTC(2025,0,30));
  const result=analyze([data,{...structuredClone(data),symbol:'COPYUSDT'}],{...options,fee:.001,slippage:.0005});
  near(result.full.stats.endValue,result.full.assets.reduce((s,a)=>s+a.endValue,0));
  near(result.full.stats.netProfit,result.full.trades.reduce((s,t)=>s+t.pnl,0));
  assert.equal(result.folds.length,3);
  assert.ok(result.full.stats.trades>0);
});
test('short samples do not claim reliable annualization or undefined ratios', () => {
  const e=Array.from({length:3},(_,i)=>({time:i*hour,value:10000}));
  const m=metrics(e,[],10000,hour);
  assert.equal(m.sharpe,null); assert.equal(m.cagr,null); assert.equal(m.profitFactor,null); assert.equal(m.trades,0);
});
