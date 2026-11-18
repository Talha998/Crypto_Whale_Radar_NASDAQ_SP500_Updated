import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDailyMovers} from '../daily-movers-server.mjs';
import {setDailyMoverSymbols,thresholdFor} from '../src/netflow/coinThresholds.js';
import {LiveMinuteFlow} from '../src/netflow/liveMinuteFlow.js';
import {NetflowAlarmGate} from '../src/netflow/netflowAlarm.js';
import {createLiveRestService} from '../spot-live-rest-server.mjs';

test('daily mover list selects five liquid gainers and five liquid losers, excluding majors and leveraged tokens',()=>{
 const tickers=[];
 for(let i=0;i<8;i++)tickers.push({symbol:`GAIN${i}USDT`,priceChangePercent:String(30-i),quoteVolume:'20000000'});
 for(let i=0;i<8;i++)tickers.push({symbol:`LOSS${i}USDT`,priceChangePercent:String(-30+i),quoteVolume:'20000000'});
 tickers.push({symbol:'BTCUSDT',priceChangePercent:'50',quoteVolume:'50000000'},{symbol:'UPTOKENUPUSDT',priceChangePercent:'90',quoteVolume:'50000000'},{symbol:'THINUSDT',priceChangePercent:'99',quoteVolume:'100000'});
 const movers=selectDailyMovers(tickers,Date.UTC(2026,10,18));
 assert.equal(movers.length,10);assert.equal(movers.filter(x=>x.side==='GAINER').length,5);assert.equal(movers.filter(x=>x.side==='LOSER').length,5);
 assert.ok(movers.every(x=>x.quoteVolume>=10_000_000&&x.thresholdUSDT===2_000_000));assert.ok(movers.every(x=>!['BTC','ETH','BNB','SOL','XRP','USDC'].includes(x.symbol)));
});

test('daily movers use a fixed $2M threshold and live minute engine can subscribe to them',()=>{
 setDailyMoverSymbols(['GAIN0','LOSS0']);assert.equal(thresholdFor('GAIN0'),2_000_000);
 const now=Date.UTC(2026,10,18),engine=new LiveMinuteFlow(now-60_000,['GAIN0']);
 const first=engine.ingest({e:'aggTrade',s:'GAIN0USDT',a:1,T:now,p:'1',q:'1999999',m:false},now);
 const second=engine.ingest({e:'aggTrade',s:'GAIN0USDT',a:2,T:now,p:'1',q:'1',m:false},now);
 assert.equal(first.event,null);assert.equal(second.event?.thresholdUSDT,2_000_000);assert.equal(second.event?.side,'BUY');
 const gate=new NetflowAlarmGate();gate.arm(now);assert.equal(gate.accept(second.event,now),true);
 setDailyMoverSymbols([]);
});

test('REST fallback validates a daily mover with its $2M threshold',async()=>{
 setDailyMoverSymbols(['GAIN0']);const now=Date.UTC(2026,10,18);
 const service=createLiveRestService({clock:()=>now,fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/time')?{serverTime:now}:[{a:1,T:now,p:'1',q:'2000000',m:false}]})});
 const result=await service(['GAIN0']);assert.deepEqual(result.events.map(x=>x.symbol),['GAIN0']);assert.equal(result.events[0].thresholdUSDT,2_000_000);
 setDailyMoverSymbols([]);
});
