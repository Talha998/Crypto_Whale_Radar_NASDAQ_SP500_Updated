import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNetflowLog,logEntry} from '../netflow-log-server.mjs';
import {createLiveRestService} from '../spot-live-rest-server.mjs';
const now=Date.UTC(2026,10,17,20,5,6);
const evt=(o={})=>({id:'BTC-1-BUY',symbol:'BTC',net:5000000,price:95000,side:'BUY',windowSeconds:60,time:now,...o});
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'netflow-log-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'logs','spot-netflow.jsonl');}
test('log captures coin, signed flow, price and Pakistan calendar rollover',()=>{
 const e=logEntry(evt(),'Binance REST verified',now);
 assert.equal(e.symbol,'BTC');assert.equal(e.datePKT,'2026-11-18');assert.equal(e.timePKT,'01:05:06');assert.equal(e.net,5000000);assert.equal(e.utc,'2026-11-17T20:05:06.000Z');
 const s=logEntry(evt({net:-6e6,side:'SELL'}),'Browser WebSocket',now);assert.equal(s.side,'SELL');
});
test('logs persist after restart and duplicates across transports are written once',async t=>{
 const file=await fixture(t),a=createNetflowLog({file,clock:()=>now});
 const results=await Promise.all([a.append(evt()),a.append(evt()),a.append(evt({id:'rest-BTC-2'}),'Binance REST verified')]);
 assert.equal(results.filter(x=>x.saved).length,1);
 const restored=createNetflowLog({file,clock:()=>now});assert.equal((await restored.list()).entries.length,1);
 assert.equal((await restored.append(evt())).duplicate,true);
 assert.equal((await readFile(file,'utf8')).trim().split('\n').length,1);
});
test('positive and negative events log independently and a later event adds a new row',async t=>{
 const file=await fixture(t),log=createNetflowLog({file,clock:()=>now+120000});
 await log.append(evt());await log.append(evt({id:'BTC-sell',side:'SELL',net:-5e6}));await log.append(evt({id:'BTC-later',time:now+60000}));
 const rows=(await log.list()).entries;assert.equal(rows.length,3);assert.equal(rows[0].id,'BTC-later');
});
test('subthreshold, contradictory and unsafe event payloads never get logged',async t=>{
 const file=await fixture(t),log=createNetflowLog({file,clock:()=>now});
 for(const patch of [{net:4999999},{net:-6e6},{windowSeconds:300},{symbol:'DOGE'},{price:null},{id:'=HYPERLINK()'}])await assert.rejects(log.append(evt(patch)));
 assert.equal((await log.list()).entries.length,0);
});
test('CSV export includes complete durable records with date, time, coin and signs',async t=>{
 const file=await fixture(t),log=createNetflowLog({file,clock:()=>now});
 await log.append(evt());await log.append(evt({id:'ETH-sell',symbol:'ETH',side:'SELL',net:-7e6,price:2000}));
 let csv='';for await(const part of log.csv())csv+=part;
 assert.match(csv,/Date \(PKT\),Time \(PKT\),Coin/);assert.match(csv,/"2026-11-18","01:05:06","BTC","BUY","5000000"/);assert.match(csv,/"ETH","SELL","-7000000"/);
});
test('a partial final line does not corrupt the next saved record',async t=>{
 const file=await fixture(t),first=createNetflowLog({file,clock:()=>now});await first.append(evt());
 const content=await readFile(file,'utf8');await writeFile(file,content+'{"incomplete":');
 const restored=createNetflowLog({file,clock:()=>now});await restored.append(evt({id:'ETH-next',symbol:'ETH'}));
 const again=createNetflowLog({file,clock:()=>now});assert.equal((await again.list()).entries.length,2);
});
test('disk write failure is visible instead of falsely confirming a save',async t=>{
 const file=await fixture(t);
 // Build a non-directory parent reliably, regardless of OS permission privileges.
 const dir=join(file,'..','..');await writeFile(join(dir,'blocked'),'x');
 const log=createNetflowLog({file:join(dir,'blocked','log.jsonl'),clock:()=>now});
 await assert.rejects(log.append(evt()));assert.match((await log.list()).error,/save|read/);
});
test('REST event capture invokes durable log callback without depending on browser alarms',async()=>{
 const recorded=[];
 const service=createLiveRestService({clock:()=>now,onEvent:async e=>recorded.push(e),fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/time')?{serverTime:now}:[{a:1,T:now,p:'100000',q:'60',m:false}]})});
 const response=await service();assert.equal(recorded.length,5);assert.equal(response.logError,'');assert.equal(recorded[0].windowSeconds,60);
});
test('logging failure does not stop live price or threshold alarms',async()=>{
 const service=createLiveRestService({clock:()=>now,onEvent:async()=>{throw Error('disk failed');},fetcher:async url=>({ok:true,status:200,json:async()=>url.includes('/time')?{serverTime:now}:[{a:1,T:now,p:'100000',q:'60',m:false}]})});
 const response=await service();assert.equal(response.stale,false);assert.equal(response.events.length,5);assert.match(response.logError,/save/);
});
test('CSV download before the first event is a valid header-only file',async t=>{
 const file=await fixture(t),log=createNetflowLog({file,clock:()=>now});let csv='';
 for await(const part of log.csv())csv+=part;
 assert.match(csv,/Date \(PKT\)/);assert.equal(csv.trim().split('\n').length,1);
});
