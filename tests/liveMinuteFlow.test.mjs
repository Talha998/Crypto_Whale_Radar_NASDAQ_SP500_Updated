import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveMinuteFlow,pktDateTime,livePrice} from '../src/netflow/liveMinuteFlow.js';
const trade=(a,T,value=1e6,m=false,s='BTCUSDT')=>({e:'aggTrade',s,a,T,p:'100000',q:String(value/100000),m});
test('1-minute feed uses actual price times quantity with sell aggressor reversal',()=>{
 const engine=new LiveMinuteFlow(0);engine.ingest(trade(1,1000,2e6),1000);const row=engine.ingest(trade(2,2000,1e6,true),2000);
 assert.equal(row.buy,2e6);assert.equal(row.sell,1e6);assert.equal(row.net,1e6);assert.equal(row.price,100000);assert.equal(row.lastTrade,2000);
});
test('warmup prevents alerts and the exact $5M threshold triggers immediately after full coverage',()=>{
 const engine=new LiveMinuteFlow(0);
 assert.equal(engine.ingest(trade(1,1000,5e6),1000).event,null);
 const ready=engine.snapshot(60000)[0];assert.equal(ready.ready,true);assert.equal(ready.event.net,5e6);
 assert.equal(engine.ingest(trade(2,60001,1e6),60001).event,null);
 const clean=new LiveMinuteFlow(0);assert.equal(clean.ingest(trade(1,60000,4999999),60000).event,null);
 const crossed=clean.ingest(trade(2,60001,1),60001).event;
 assert.equal(crossed.net,5e6);assert.equal(crossed.time,60001);assert.equal(crossed.side,'BUY');assert.equal(crossed.price,100000);
});
test('negative $5M produces selling event, and each coin has independent coverage',()=>{
 const engine=new LiveMinuteFlow(0);const row=engine.ingest(trade(1,60000,5e6,true,'ETHUSDT'),60000);
 assert.equal(row.event.side,'SELL');assert.equal(row.event.net,-5e6);assert.equal(engine.snapshot(60000)[0].net,0);
});
test('rolling expiry removes old trades without waiting for another trade',()=>{
 const engine=new LiveMinuteFlow(0);engine.ingest(trade(1,1000,5e6),1000);
 assert.equal(engine.snapshot(60999)[0].net,5e6);assert.equal(engine.snapshot(61000)[0].net,0);
});
test('duplicate and malformed frames do not inflate netflow or price',()=>{
 const engine=new LiveMinuteFlow(0);engine.ingest(trade(1,1000),1000);
 assert.equal(engine.ingest(trade(1,1000),1001),null);assert.equal(engine.ingest({...trade(2,1002),m:'false'},1002),null);
 assert.equal(engine.ingest({...trade(2,1002),p:'NaN'},1002),null);
 assert.equal(engine.ingest(trade(2,1000000),1002),null);assert.equal(engine.snapshot(1002)[0].net,1e6);
});
test('a missing trade ID resets only that coin and prevents incomplete-minute alerts',()=>{
 const engine=new LiveMinuteFlow(0);engine.ingest(trade(1,60000),60000);
 const gap=engine.ingest(trade(3,61000,6e6),61000);assert.equal(gap.ready,false);assert.equal(gap.remaining,60);assert.equal(gap.event,null);assert.equal(gap.net,6e6);
});
test('cooldown suppresses repeated crossings in the same minute',()=>{
 const engine=new LiveMinuteFlow(0);assert.ok(engine.ingest(trade(1,60000,6e6),60000).event);
 engine.ingest(trade(2,60001,2e6,true),60001);
 assert.equal(engine.ingest(trade(3,60002,2e6),60002).event,null);
});
test('reconnect clears incomplete buffers and begins a fresh 60-second window',()=>{
 const engine=new LiveMinuteFlow(0);engine.ingest(trade(1,60000,6e6),60000);engine.reset(60010);
 const row=engine.snapshot(60011)[0];assert.equal(row.ready,false);assert.equal(row.net,0);assert.equal(row.price,null);
});
test('event dates include calendar date, seconds and Pakistan timezone',()=>{
 const formatted=pktDateTime(Date.UTC(2026,10,17,23,15,30));
 assert.match(formatted,/18 Nov 2026/);assert.match(formatted,/04:15:30 PKT/);assert.equal(livePrice(100000),'$100,000.00');assert.equal(livePrice(null),'—');
});
