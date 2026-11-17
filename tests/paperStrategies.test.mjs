import test from 'node:test';
import assert from 'node:assert/strict';
import {openPaper,exitPaper,stats,qualified,parseBars,indicators,signalAt,backtest} from '../src/paper/strategies.js';
import {createPaperService} from '../paper-trading-server.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
test('historical wins need enough unseen samples and positive profit to qualify',()=>{
 const base={trades:20,winRate:85,pnl:100,profitFactor:2};assert.equal(qualified({holdout:base},80),true);assert.equal(qualified({holdout:base},90),false);
 for(const patch of [{trades:19},{pnl:-1},{profitFactor:0.9},{winRate:79}])assert.equal(qualified({holdout:{...base,...patch}},80),false);
});
test('simulated long and short fills include adverse slippage and two-sided fees',()=>{
 const long=openPaper('BUY',100,0),short=openPaper('SELL',100,0);assert.ok(long.entry>100);assert.ok(short.entry<100);
 const sell=exitPaper(long,{time:0,end:59999,open:100,high:103,low:100,close:102});assert.equal(sell.reason,'Take profit');assert.ok(sell.pnl<sell.gross);assert.ok(sell.fees>0);
 const cover=exitPaper(short,{time:0,end:59999,open:100,high:100,low:97,close:98});assert.equal(cover.reason,'Take profit');assert.ok(cover.pnl>0);
});
test('ambiguous intrabar SL/TP selects loss, and price gaps fill worse than stop',()=>{
 const p=openPaper('BUY',100,0);const both=exitPaper(p,{time:0,end:59999,open:100,high:104,low:98,close:102});assert.equal(both.reason,'Stop loss');assert.ok(both.pnl<0);
 const gap=exitPaper(p,{time:60000,end:119999,open:90,high:91,low:89,close:90});assert.ok(gap.exit<90);
});
test('time exit and stats count net-of-cost wins instead of gross-positive trades',()=>{
 const p=openPaper('BUY',100,0),close=exitPaper(p,{time:900000,end:959999,open:100,high:100.1,low:99.9,close:100.1});assert.equal(close.reason,'15-minute timeout');assert.ok(close.pnl<0);
 const s=stats([close,{pnl:20}]);assert.equal(s.winRate,50);assert.ok(s.maxDrawdown>0);
});
function bars(count=500){return Array.from({length:count},(_,i)=>{const price=100+Math.sin(i/7)*2+i*.001;return {time:i*60000,end:i*60000+59999,open:price,close:price+.05,high:price+.2,low:price-.2,volume:100+(i%19)*10,quote:10000,buy:i%30<15?8500:1500};});}
test('strategy signals cannot see future candles and gaps invalidate entry signals',()=>{
 const all=bars(),cut=all.slice(0,200),before=signalAt('flow',cut,indicators(cut),199);assert.equal(before,signalAt('flow',all,indicators(all),199));
 cut[190]={...cut[190],time:cut[190].time+1000};assert.equal(signalAt('flow',cut,indicators(cut),199),null);
});
test('holdout stats exclude pre-split entries and have no fabricated 80% fallback',()=>{
 const data=bars();const result=backtest('flow',data);assert.ok(result.holdout.trades<=result.overall.trades);assert.equal(result.splitTime,data[350].time);
 const empty=backtest('ema',[]);assert.equal(empty.holdout.winRate,null);assert.equal(qualified(empty,80),false);
});
test('paper simulator uses public candles only, preserves settings and creates 15 independent ledgers',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'paper-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');
 const count=200,now=count*60000+30000;
 const raw=Array.from({length:count+1},(_,i)=>[i*60000,'100','101','99','100','100',i*60000+59999,'10000',1,'60','6000']);
 let requests=0;const fetcher=async url=>{requests++;assert.ok(url.includes('/api/v3/klines'));assert.ok(!url.includes('order'));return {ok:true,json:async()=>raw};};
 const service=createPaperService({file,clock:()=>now,fetcher});const first=await service.get();assert.equal(first.rows.length,15);assert.equal(first.mode,'practice');assert.equal(requests,5);
 await service.configure({mode:'qualified',minimum:90,running:false});const persisted=JSON.parse(await readFile(file,'utf8'));assert.equal(persisted.mode,'qualified');assert.equal(persisted.minimum,90);assert.equal(persisted.running,false);
 const restart=createPaperService({file,clock:()=>now,fetcher});const restored=await restart.get();assert.equal(restored.mode,'qualified');assert.equal(restored.rows[0].account.balance,10000);
});
