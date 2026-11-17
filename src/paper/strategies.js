export const STRATEGIES=[{id:'ema',name:'EMA 9/21 + VWAP'},{id:'breakout',name:'20-minute breakout + volume'},{id:'flow',name:'Taker flow + trend'}];
export const RULES={initial:10000,stake:1000,fee:0.001,slippage:0.0005,stop:0.005,target:0.01,maxHold:15*60000,minSamples:20};
export function parseBars(raw,now=Date.now()) {
 return raw.map(k=>({time:Number(k[0]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),end:Number(k[6]),quote:Number(k[7]),buy:Number(k[10])})).filter(b=>Object.values(b).every(Number.isFinite)&&b.time<=now&&b.open>0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.volume>=0&&b.quote>=0&&b.buy>=0&&b.buy<=b.quote).sort((a,b)=>a.time-b.time);
}
export function indicators(bars) {
 let fast,slow,priceVolume=0,volume=0,day;
 return bars.map((b,i)=>{
  fast=fast===undefined?b.close:fast+(b.close-fast)*2/10;slow=slow===undefined?b.close:slow+(b.close-slow)*2/22;
  const d=Math.floor(b.time/86400000);if(d!==day){priceVolume=0;volume=0;day=d;}
  priceVolume+=(b.high+b.low+b.close)/3*b.volume;volume+=b.volume;
  const prev=bars.slice(Math.max(0,i-20),i),flow=bars.slice(Math.max(0,i-2),i+1),q=flow.reduce((s,x)=>s+x.quote,0);
  return {fast,slow,vwap:volume?priceVolume/volume:b.close,avgVolume:prev.length?prev.reduce((s,x)=>s+x.volume,0)/prev.length:0,high:prev.length?Math.max(...prev.map(x=>x.high)):b.high,low:prev.length?Math.min(...prev.map(x=>x.low)):b.low,flow:q?flow.reduce((s,x)=>s+2*x.buy-x.quote,0)/q:0};
 });
}
export function signalAt(id,bars,features,i) {
 if(i<30)return null;
 // Missing candle history invalidates all indicator windows around this point.
 for(let j=i-30;j<i;j++)if(bars[j+1].time-bars[j].time!==60000)return null;
 const b=bars[i],f=features[i],p=features[i-1];
 if(id==='ema'){
  if(p.fast<=p.slow&&f.fast>f.slow&&b.close>f.vwap)return 'BUY';
  if(p.fast>=p.slow&&f.fast<f.slow&&b.close<f.vwap)return 'SELL';
 }
 if(id==='breakout'&&b.volume>f.avgVolume*1.5){
  if(b.close>f.high&&f.fast>f.slow)return 'BUY';
  if(b.close<f.low&&f.fast<f.slow)return 'SELL';
 }
 if(id==='flow'){
  if(f.flow>0.2&&f.fast>f.slow&&b.close>f.vwap&&b.close>bars[i-1].close)return 'BUY';
  if(f.flow< -0.2&&f.fast<f.slow&&b.close<f.vwap&&b.close<bars[i-1].close)return 'SELL';
 }
 return null;
}
export function openPaper(side,price,time,stake=RULES.stake){
 const dir=side==='BUY'?1:-1,entry=price*(1+dir*RULES.slippage);
 return {side,dir,entry,time,stake,qty:stake/entry,stop:entry*(1-dir*RULES.stop),target:entry*(1+dir*RULES.target)};
}
export function exitPaper(position,bar){
 if(bar.time<position.time)return null;
 const p=position,stopHit=p.dir===1?bar.low<=p.stop:bar.high>=p.stop,targetHit=p.dir===1?bar.high>=p.target:bar.low<=p.target;
 let price,reason;
 // When both levels are touched, use the adverse outcome. Gaps fill at the worse open.
 if(stopHit){price=p.dir===1?Math.min(p.stop,bar.open):Math.max(p.stop,bar.open);reason='Stop loss';}
 else if(targetHit){price=p.target;reason='Take profit';}
 else if(bar.end-p.time>=RULES.maxHold){price=bar.close;reason='15-minute timeout';}
 else return null;
 const exit=price*(1-p.dir*RULES.slippage),gross=p.dir*(exit-p.entry)*p.qty,fees=(p.entry+exit)*p.qty*RULES.fee;
 return {...p,exit,exitTime:bar.end,reason,gross,fees,pnl:gross-fees};
}
export function stats(trades){
 const wins=trades.filter(t=>t.pnl>0),profit=wins.reduce((s,t)=>s+t.pnl,0),loss=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0),n=trades.length,net=trades.reduce((s,t)=>s+t.pnl,0);
 let equity=RULES.initial,peak=equity,maxDrawdown=0;
 for(const t of trades){equity+=t.pnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);}
 return {trades:n,wins:wins.length,winRate:n?wins.length/n*100:null,pnl:net,profitFactor:loss?profit/loss:profit?null:0,noLosses:profit>0&&!loss,maxDrawdown};
}
export function backtest(id,bars,features=indicators(bars)){
 const trades=[];let position=null,pending=null;
 for(let i=31;i<bars.length;i++){
  const b=bars[i];
  if(!position&&pending&&b.time===pending.time+60000){position=openPaper(pending.side,b.open,b.time);pending=null;}
  if(position){const exit=exitPaper(position,b);if(exit){trades.push(exit);position=null;}}
  if(!position){const side=signalAt(id,bars,features,i);pending=side?{side,time:b.time}:null;}
 }
 // Purge trades spanning the chronological split. Indicators may use earlier context.
 const split=bars[Math.floor(bars.length*0.7)]?.time??Infinity;
 const holdout=trades.filter(t=>t.time>=split);
 return {overall:stats(trades),holdout:stats(holdout),splitTime:split,from:bars[0]?.time,to:bars.at(-1)?.end};
}
export function qualified(result,minimum=80){const s=result.holdout;return s.trades>=RULES.minSamples&&s.winRate>=minimum&&s.pnl>0&&(s.profitFactor>1||s.noLosses===true);}
