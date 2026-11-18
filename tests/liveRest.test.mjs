import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveRestService} from '../spot-live-rest-server.mjs';
const response=data=>({ok:true,status:200,json:async()=>data});
const trade=(a,T,value=1000000,m=false)=>({a,T,p:'100000',q:String(value/100000),m});
const start=1000000;
test('REST fallback bootstraps full minute, price, exact signed volume and caches across callers',async()=>{
 let calls=0;
 const service=createLiveRestService({clock:()=>start,fetcher:async url=>{calls++;return response(url.includes('/time')?{serverTime:start}:[trade(1,start-1000,7000000),trade(2,start,2000000,true)]);}});
 const [a,b]=await Promise.all([service(),service()]);
 assert.deepEqual(a,b);assert.equal(calls,7);assert.equal(a.stale,false);assert.equal(a.rows.length,6);
 assert.equal(a.rows[0].net,5000000);assert.equal(a.rows[0].price,100000);assert.equal(a.rows[0].ready,true);assert.equal(a.rows[0].lastTrade,start);assert.equal(a.events[0].time,start);
 await service();assert.equal(calls,7);
});
test('trade pagination consumes all records instead of truncating a busy BTC minute',async()=>{
 const page=Array.from({length:1000},(_,i)=>trade(i+1,start-1000,100));
 let secondPages=0;
 const service=createLiveRestService({clock:()=>start,fetcher:async url=>{
   if(url.includes('/time'))return response({serverTime:start});
   if(url.includes('fromId=')){secondPages++;return response([trade(1001,start,100)]);}
   return response(page);
 }});
 const r=await service();assert.equal(secondPages,6);assert.equal(r.rows[0].tradeCount,1001);assert.equal(r.rows[0].net,100100);
});
test('missing trade IDs and malformed prices cannot create a verified netflow',async()=>{
 const service=createLiveRestService({clock:()=>start,fetcher:async url=>response(url.includes('/time')?{serverTime:start}:[trade(1,start-1),trade(3,start)])});
 const r=await service();assert.equal(r.stale,true);assert.ok(r.rows.every(x=>x.stale));assert.equal(r.events.length,0);
});
test('failed refresh retains values as stale and never emits fresh events',async()=>{
 let now=start,fail=false;
 const service=createLiveRestService({clock:()=>now,fetcher:async url=>{if(fail)throw Error('unavailable');return response(url.includes('/time')?{serverTime:now}:[trade(1,now,6e6)]);}});
 const a=await service();now+=3100;fail=true;const b=await service();
 assert.equal(b.stale,true);assert.equal(b.rows[0].price,a.rows[0].price);assert.equal(b.events.length,a.events.length);assert.ok(b.rows.every(r=>r.stale));
});
test('repeated above-threshold snapshots do not spam events and negative crossing records selling',async()=>{
 let now=start,sell=false;
 const service=createLiveRestService({clock:()=>now,fetcher:async url=>response(url.includes('/time')?{serverTime:now}:[trade(1,now,6e6,sell)])});
 const a=await service();assert.equal(a.events.length,6);now+=3100;const b=await service();assert.equal(b.events.length,6);
 now+=3100;sell=true;const c=await service();assert.equal(c.events.length,12);assert.equal(c.events[0].side,'SELL');assert.equal(c.events[0].net,-6e6);
});
test('quiet minute has zero net flow, with latest known actual trade price',async()=>{
 const service=createLiveRestService({clock:()=>start,fetcher:async url=>response(url.includes('/time')?{serverTime:start}:url.includes('limit=1')&&!url.includes('limit=1000')?[trade(1,start-120000,100)]:[])});
 const r=await service();assert.equal(r.rows[0].net,0);assert.equal(r.rows[0].price,100000);assert.equal(r.rows[0].lastTrade,start-120000);assert.equal(r.events.length,0);
});
test('exchange clock offset aligns queries even if the machine clock is wrong',async()=>{
 let query;
 const service=createLiveRestService({clock:()=>start,fetcher:async url=>{
  if(url.includes('/time'))return response({serverTime:start+3600000});query=new URL(url);return response([trade(1,start+3600000,100)]);
 }});
 const r=await service();assert.equal(query.searchParams.get('endTime'),String(start+3600000));assert.equal(r.rows[0].net,100);assert.equal(r.rows[0].ready,true);
});
