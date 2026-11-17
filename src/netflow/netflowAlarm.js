import {COINS} from './netflow.js';
// A fresh observed 60s threshold event may sound once. Restored history cannot replay.
export class NetflowAlarmGate {
  constructor() {this.enabled=false;this.armedAt=Infinity;this.seen=new Set();this.last=new Map();}
  arm(now=Date.now()) {this.enabled=true;this.armedAt=now;}
  disable() {this.enabled=false;}
  accept(event,now=Date.now()) {
    if(!this.enabled||!event||typeof event.id!=='string'||!COINS.includes(event.symbol)||event.windowSeconds!==60||!Number.isFinite(event.net)||Math.abs(event.net)<5000000||!Number.isFinite(event.time)||event.time<this.armedAt||now-event.time>15000||event.time>now+2000) return false;
    if((event.net>0&&event.side!=='BUY')||(event.net<0&&event.side!=='SELL')||this.seen.has(event.id))return false;
    const key=event.symbol+'-'+event.side;
    if(event.time-(this.last.get(key)??-Infinity)<60000)return false;
    this.seen.add(event.id);this.last.set(key,event.time);
    if(this.seen.size>500)this.seen.delete(this.seen.values().next().value);
    return true;
  }
}
