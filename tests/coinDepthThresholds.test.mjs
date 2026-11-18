import test from 'node:test';import assert from 'node:assert/strict';
import {thresholdFor,COIN_GROUPS} from '../src/netflow/coinThresholds.js';
import {LiveMinuteFlow} from '../src/netflow/liveMinuteFlow.js';
import {NetflowAlarmGate} from '../src/netflow/netflowAlarm.js';
import {logEntry} from '../netflow-log-server.mjs';
import {summarizeDepth} from '../src/netflow/depthMath.js';
import {createDepthService} from '../liquidity-depth-server.mjs';
import {createLiveRestService} from '../spot-live-rest-server.mjs';
const now=Date.UTC(2026,10,18);
test('all six crypto coins use the fixed ±$5M rolling-minute threshold',()=>{
 assert.deepEqual(COIN_GROUPS[0].coins,['BTC','USDC','ETH','BNB','SOL','XRP']);
 assert.deepEqual(['BTC','USDC','ETH','BNB','SOL','XRP'].map(thresholdFor),[5000000,5000000,5000000,5000000,5000000,5000000]);assert.equal(thresholdFor('UNKNOWN'),Infinity);
});
test('each positive/negative WS crossing flows through the same alarm and log threshold',()=>{
 for(const coin of ['BTC','USDC','ETH','BNB','SOL','XRP'])for(const side of ['BUY','SELL']){
  const engine=new LiveMinuteFlow(now-60000),threshold=thresholdFor(coin),sell=side==='SELL';
  const frame=(id,value)=>({e:'aggTrade',s:coin+'USDT',a:id,T:now,p:'1',q:String(value),m:sell});
  assert.equal(engine.ingest(frame(1,threshold-1),now).event,null);
  const event=engine.ingest(frame(2,1),now).event;assert.equal(event.thresholdUSDT,threshold);assert.equal(event.side,side);
  const alarm=new NetflowAlarmGate();alarm.arm(now);assert.equal(alarm.accept(event,now),true);assert.equal(alarm.accept(event,now),false);
  assert.equal(logEntry(event,'Browser WebSocket',now).thresholdUSDT,threshold);
  assert.throws(()=>logEntry({...event,net:(threshold-1)*(sell?-1:1)},'Browser WebSocket',now));
 }
});
test('REST waits for ±$5M for every coin before emitting a minute alarm',async()=>{
 const service=createLiveRestService({clock:()=>now,fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/time')?{serverTime:now}:[{a:1,T:now,p:'1',q:'6000000',m:false}]})});
 const result=await service();assert.deepEqual(result.events.map(e=>e.symbol).sort(),['BNB','BTC','ETH','SOL','USDC','XRP']);assert.ok(result.events.every(e=>e.thresholdUSDT===5000000));
});
const book={lastUpdateId:12,bids:[['99.99','10'],['99.8','20'],['99','30']],asks:[['100.01','5'],['100.2','10'],['101','15']]};
test('book depth sums price × quantity inside each mid-price band',()=>{
 const result=summarizeDepth(book,3),half=result.bands.find(b=>b.band===0.005);
 assert.equal(result.mid,100);assert.ok(Math.abs(result.spreadPct-0.02)<1e-8);assert.ok(Math.abs(half.bidUSDT-(999.9+1996))<1e-8);assert.ok(Math.abs(half.askUSDT-(500.05+1002))<1e-8);assert.equal(half.bidComplete,true);assert.equal(half.askComplete,true);
});
test('a capped book that does not reach the full band is explicitly partial',()=>{
 const result=summarizeDepth({bids:[['99.99','1'],['99.98','1']],asks:[['100.01','1'],['100.02','1']]},2);
 assert.ok(result.bands.every(b=>!b.bidComplete&&!b.askComplete));
});
test('crossed, unsorted and malformed book data cannot become a liquidity signal',()=>{
 assert.throws(()=>summarizeDepth({...book,bids:[['101','1']]}));assert.throws(()=>summarizeDepth({...book,asks:[['100.2','1'],['100.1','1']]}));assert.throws(()=>summarizeDepth({...book,asks:[['bad','1']]}));assert.throws(()=>summarizeDepth({...book,bids:[]}));
});
test('snapshot requests are shared and failed refreshes retain old book as stale',async()=>{
 let clock=now,calls=0,fail=false;const service=createDepthService({clock:()=>clock,fetcher:async()=>{calls++;if(fail)throw Error('blocked');return {ok:true,status:200,json:async()=>book};}});
 const [a,b]=await Promise.all([service(),service()]);assert.deepEqual(a,b);assert.equal(calls,6);assert.equal(a.rows.length,6);assert.ok(a.rows.every(r=>!r.stale));await service();assert.equal(calls,6);
 clock+=11000;fail=true;const old=await service();assert.equal(old.stale,true);assert.equal(old.rows[0].fetchedAt,now);assert.equal(old.rows[0].mid,100);
});
