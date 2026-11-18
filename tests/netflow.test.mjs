import test from 'node:test';
import assert from 'node:assert/strict';
import {candleFlow,normalizeCoinGlass,usd} from '../src/netflow/netflow.js';
import {createNetflowService} from '../spot-netflow-server.mjs';
const bar=(at,total=100,buy=75)=>{const b=[at];b[7]=String(total);b[10]=String(buy);return b;};
test('net flow uses buy minus sell, preserving negative and zero',()=>{
  const now=600000, bars=Array.from({length:5},(_,i)=>bar(now-i*60000));
  assert.equal(candleFlow(bars,5,now),250);
  assert.equal(candleFlow(bars.map(c=>bar(c[0],100,25)),5,now),-250);
  assert.equal(candleFlow(bars.map(c=>bar(c[0],100,50)),5,now),0);
});
test('gaps, malformed values and duplicate timestamps cannot invent complete history',()=>{
 const b=Array.from({length:5},(_,i)=>bar(600000-i*60000));
 assert.equal(candleFlow(b.slice(1),5,600000),null);
 assert.equal(candleFlow([...b.slice(1),b[1]],5,600000),null);
 b[0][7]='bad';assert.equal(candleFlow(b,5,600000),null);
});
test('CoinGlass maps only requested coins and never turns missing into zero',()=>{
 const rows=normalizeCoinGlass([{symbol:'BTC',net_flow_usd_5m:5000000,net_flow_usd_7d:-12,market_cap:null},{symbol:'DOGE'}]);
 assert.equal(rows.length,6);assert.equal(rows[0].values['5m'],5000000);assert.equal(rows[0].values['7d'],-12);
 assert.equal(rows[1].values['5m'],null);assert.equal(rows[0].marketCap,null);
 assert.equal(usd(5000000),'+$5.00M');assert.equal(usd(-5000000),'-$5.00M');assert.equal(usd(null),'—');
});
test('server caches, deduplicates requests, marks refresh failure stale and keeps key private',async()=>{
 let now=100000, calls=0, fail=false;
 const service=createNetflowService({key:'private-test-key',clock:()=>now,fetcher:async()=>{calls++;if(fail)throw Error('private-test-key');return {ok:true,json:async()=>({code:'0',data:['BTC','ETH','BNB','USDC','XRP','SOL'].map(symbol=>({symbol,net_flow_usd_5m:5e6}))})};}});
 const [a,b]=await Promise.all([service(),service()]);assert.equal(calls,1);assert.deepEqual(a,b);
 await service();assert.equal(calls,1);now+=31000;fail=true;
 const stale=await service();assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,100000);assert.ok(!JSON.stringify(stale).includes('private-test-key'));
});
test('free feed calculates all coins and long windows from real candle schema',async()=>{
 const now=Date.UTC(2026,10,17,12,30);
 const service=createNetflowService({clock:()=>now,fetcher:async url=>({ok:true,json:async()=>{
   if(url.includes('coingecko'))return [{symbol:'btc',market_cap:1e12}];
   const hour=url.includes('interval=1h');const step=hour?3600000:60000, end=Math.floor(now/step)*step;
   return Array.from({length:hour?721:1000},(_,i)=>bar(end-i*step)).reverse();
 }})});
 const result=await service();assert.equal(result.stale,false);assert.equal(result.rows.length,6);assert.equal(result.rows[0].values['5m'],250);assert.ok(Number.isFinite(result.rows[0].values['30d']));
 assert.equal(result.rows[0].marketCap,1e12);assert.equal(result.rows[1].marketCap,null);
});
test('long windows use the provider minute boundary when the local machine clock differs',async()=>{
 const provider=Date.UTC(2026,10,17,12,30),machine=provider+7200000;
 const service=createNetflowService({clock:()=>machine,fetcher:async url=>({ok:true,json:async()=>{
  if(url.includes('coingecko'))return [];
  const hourly=url.includes('interval=1h'),step=hourly?3600000:60000,end=Math.floor(provider/step)*step;
  return Array.from({length:hourly?721:1000},(_,i)=>bar(end-i*step)).reverse();
 }})});
 const r=await service();assert.ok(r.rows.every(row=>Number.isFinite(row.values['24h'])&&Number.isFinite(row.values['30d'])));
});
