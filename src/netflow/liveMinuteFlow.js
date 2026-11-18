import {thresholdFor} from './coinThresholds.js';
import {COINS} from './netflow.js';
export const LIVE_WINDOW_MS = 60000;

export function pktDateTime(ms) {
  return Number.isFinite(ms) ? new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(ms)+' PKT' : 'Waiting for live trade';
}
export function livePrice(value) {
  return Number.isFinite(value) ? '$'+value.toLocaleString('en-US',{minimumFractionDigits:value<2?4:2,maximumFractionDigits:value<2?6:2}) : '—';
}
export class LiveMinuteFlow {
  constructor(now=Date.now(),symbols=COINS) { this.symbols=[...new Set(symbols)];this.reset(now); }
  reset(now) { this.states=new Map(this.symbols.map(symbol=>[symbol,{symbol,start:now,queue:[],head:0,buy:0,sell:0,lastId:null,lastTrade:null,price:null,regime:0,cooldown:{}}])); }
  ingest(trade,now=Date.now()) {
    const s=this.states.get(String(trade?.s||'').replace(/USDT$/,''));
    const price=Number(trade?.p),qty=Number(trade?.q),time=Number(trade?.T),id=trade?.a;
    if(!s || trade.e!=='aggTrade' || !Number.isSafeInteger(id) || typeof trade.m!=='boolean' || !Number.isFinite(price) || price<=0 || !Number.isFinite(qty) || qty<=0 || !Number.isFinite(time) || time>now+10000 || time<=now-LIVE_WINDOW_MS || (s.lastId!==null && id<=s.lastId)) return null;
    // A missing aggregate ID means this coin's 60-second coverage is incomplete.
    if(s.lastId!==null && id!==s.lastId+1) {
      s.queue=[];s.head=0;s.buy=0;s.sell=0;s.start=now;s.regime=0;
    }
    s.lastId=id;s.price=price;s.lastTrade=time;
    const value=price*qty;if(!Number.isFinite(value)) return null;
    s.queue.push({time,value,buy:!trade.m});
    if(trade.m) s.sell+=value;else s.buy+=value;
    return this.evaluate(s,now);
  }
  evaluate(s,now) {
    while(s.head<s.queue.length && s.queue[s.head].time<=now-LIVE_WINDOW_MS) {
      const old=s.queue[s.head++];if(old.buy)s.buy-=old.value;else s.sell-=old.value;
    }
    if(s.head>2000 && s.head>s.queue.length/2) {s.queue=s.queue.slice(s.head);s.head=0;}
    const net=s.buy-s.sell,ready=now-s.start>=LIVE_WINDOW_MS;
    const thresholdUSDT=thresholdFor(s.symbol);
    const regime=ready ? net>=thresholdUSDT?1:net<=-thresholdUSDT?-1:0 : 0;
    let event=null;
    if(regime && regime!==s.regime && now-(s.cooldown[regime]??-Infinity)>=LIVE_WINDOW_MS) {
      s.cooldown[regime]=now;
      event={id:`${s.symbol}-${now}-${regime}`,symbol:s.symbol,side:regime>0?'BUY':'SELL',net,buy:s.buy,sell:s.sell,price:s.price,time:now,tradeTime:s.lastTrade,thresholdUSDT,windowSeconds:60,source:'Binance Spot USDT'};
    }
    s.regime=regime;
    return {symbol:s.symbol,thresholdUSDT,net,buy:s.buy,sell:s.sell,price:s.price,lastTrade:s.lastTrade,ready,remaining:Math.max(0,Math.ceil((LIVE_WINDOW_MS-(now-s.start))/1000)),event};
  }
  snapshot(now=Date.now()) {return this.symbols.map(symbol=>this.evaluate(this.states.get(symbol),now));}
}
