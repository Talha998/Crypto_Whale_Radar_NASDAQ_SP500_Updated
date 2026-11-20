import {thresholdFor} from './src/netflow/coinThresholds.js';
import {createNetflowLog,attachNetflowLog} from './netflow-log-server.mjs';
import {COINS} from './src/netflow/netflow.js';
import {isCurrentDailyMover} from './daily-movers-server.mjs';
import {TRADFI_SYMBOLS} from './src/netflow/tradFiMarkets.js';
import {SPOT_MARKET,FUTURES_MARKET} from './binance-market-data.mjs';
const LIMIT=1000, MAX_PAGES=30;

// Exact trade-based rolling minute. Used when the browser's WebSocket is blocked.
export function createLiveRestService({fetcher=fetch,clock=Date.now,onEvent=async()=>{},market=SPOT_MARKET,
  allowedSymbol=symbol=>COINS.includes(symbol)||isCurrentDailyMover(symbol),
  alarms=true, refreshMs=3000,
}={}) {
  let cached,pending,lastAttempt=0,offset=0,offsetAt=null,deadline=Infinity,blockedUntil=0;
  const states=new Map(),events=[];
  async function get(path) {
    if(clock()<blockedUntil)throw Error('Binance rate limit cooldown');
    let last;
    for(const host of market.hosts) {
      try {
        const remaining=deadline-Date.now();
        if(remaining<=0)throw Error('Live snapshot timed out');
        const res=await fetcher(host+market.prefix+path,{signal:AbortSignal.timeout(Math.max(1,Math.min(10000,remaining)))});
        if(res.status===429 || res.status===418) {
          blockedUntil=clock()+Math.max(60000,(Number(res.headers?.get?.('retry-after'))||60)*1000);
          throw Object.assign(Error('Binance rate limit: waiting before retry'),{limited:true});
        }
        if(!res.ok)throw Error(`Binance HTTP ${res.status}`);
        return await res.json();
      }catch(e){if(e.limited)throw e;last=e;}
    }
    throw last;
  }
  async function oneCoin(symbol,end) {
    const start=end-60000;
    let page=await get(`/aggTrades?symbol=${encodeURIComponent(symbol+'USDT')}&startTime=${start}&endTime=${end}&limit=${LIMIT}`);
    const trades=[];let complete=false,lastId=null;
    for(let count=0;count<MAX_PAGES;count++) {
      if(!Array.isArray(page))throw Error('Invalid trade response');
      for(const t of page) {
        if(!Number.isSafeInteger(t.a)||!Number.isFinite(Number(t.T)))throw Error('Invalid trade identity');
        if(lastId!==null && t.a!==lastId+1)throw Error('Trade history has a gap');
        lastId=t.a;
        if(Number(t.T)>start && Number(t.T)<=end)trades.push(t);
      }
      if(page.length<LIMIT || Number(page.at(-1)?.T)>=end){complete=true;break;}
      if(count===MAX_PAGES-1)break;
      page=await get(`/aggTrades?symbol=${encodeURIComponent(symbol+'USDT')}&fromId=${lastId+1}&limit=${LIMIT}`);
    }
    if(!complete)throw Error('Trade history is too busy to verify a complete minute');
    let buy=0,sell=0;
    for(const t of trades) {
      const price=Number(t.p),qty=Number(t.q),value=price*qty;
      if(!Number.isFinite(value)||price<=0||qty<=0||typeof t.m!=='boolean')throw Error('Invalid trade amount');
      if(t.m)sell+=value;else buy+=value;
    }
    let latest=trades.at(-1);
    if(!latest) {
      const recent=await get(`/aggTrades?symbol=${encodeURIComponent(symbol+'USDT')}&limit=1`);
      if(Array.isArray(recent)&&recent.length)latest=recent[0];
    }
    const price=latest?Number(latest.p):null,lastTrade=latest?Number(latest.T):null;
    if(price!==null&&(!Number.isFinite(price)||price<=0||!Number.isFinite(lastTrade)))throw Error('Invalid price response');
    return {symbol,net:buy-sell,buy,sell,price,lastTrade,ready:true,remaining:0,asOf:end,tradeCount:trades.length};
  }
  async function refresh(symbols) {
    deadline=Date.now()+25000;
    const started=clock();
    if(offsetAt===null || started-offsetAt>60000) {
      // Align the range with exchange time instead of depending on a user's PC clock.
      const time=await get('/time');
      if(!Number.isFinite(time?.serverTime))throw Error('Exchange time unavailable');
      offset=time.serverTime-clock();offsetAt=clock();
    }
    const end=clock()+offset;
    const results=await Promise.allSettled(symbols.map(symbol=>oneCoin(symbol,end)));
    const observedAt=clock(),ageMs=Math.max(0,observedAt-(end-offset));
    const toLog=[];
    const rows=results.map((r,i)=>{
      const symbol=symbols[i];
      if(r.status!=='fulfilled'||ageMs>15000) {
        const old=cached?.rows.find(x=>x.symbol===symbol);
        return {...(old||{symbol,net:null,price:null,lastTrade:null,ready:false,remaining:60}),stale:true,error:'Live trade API unavailable or incomplete'};
      }
      const row=r.value;
      const old=states.get(symbol)||{regime:0,cooldown:{}};
      const thresholdUSDT=alarms?thresholdFor(symbol):Infinity;
      const direction=row.net>=thresholdUSDT?1:row.net<=-thresholdUSDT?-1:0;
      if(direction&&direction!==old.regime&&observedAt-(old.cooldown[direction]??-Infinity)>=60000) {
        old.cooldown[direction]=observedAt;
        events.unshift({id:`rest-${symbol}-${observedAt}-${direction}`,symbol,side:direction>0?'BUY':'SELL',net:row.net,buy:row.buy,sell:row.sell,price:row.price,time:observedAt,tradeTime:row.lastTrade,thresholdUSDT,windowSeconds:60,source:'Binance Spot USDT · REST 3s'});
        toLog.push(events[0]);
        if(events.length>100)events.length=100;
      }
      old.regime=direction;states.set(symbol,old);
      return {...row,thresholdUSDT,stale:false};
    });
    const saved=await Promise.allSettled(toLog.map(event=>onEvent(event)));
    const logError=saved.some(r=>r.status==='rejected')?'Could not save a netflow log entry':'';
    return {rows,events:[...events],logError,fetchedAt:observedAt,ageMs,asOf:end,stale:rows.every(r=>r.stale),source:market===FUTURES_MARKET?'Binance Futures · REST':'Binance Spot · REST fallback · 3s'};
  }
  return async(requestedSymbols=COINS)=>{
    const symbols=[...new Set(requestedSymbols)].filter(allowedSymbol).slice(0,16);
    if(!symbols.length) return {rows:[],events:[],fetchedAt:clock(),stale:true,error:'No supported symbols requested'};
    if(cached&&cached.symbols?.join(',')===symbols.join(',')&&clock()-lastAttempt<refreshMs)return cached;
    if(pending)return pending;
    lastAttempt=clock();
    pending=refresh(symbols).then(data=>cached={...data,symbols}).catch(()=>{
      cached={rows:symbols.map(symbol=>({...cached?.rows.find(r=>r.symbol===symbol),symbol,stale:true})),events:[...events],fetchedAt:cached?.fetchedAt??null,stale:true,source:market===FUTURES_MARKET?'Binance Futures · REST':'Binance Spot · REST fallback · 3s',error:'Live REST API unavailable. Check server internet access and Binance restrictions.',symbols};return cached;
    }).finally(()=>{pending=null;});
    return pending;
  };
}
export function liveRestPlugin() {
  function attach(server) {
    const log=createNetflowLog();
    attachNetflowLog(server.middlewares,log);
    const service=createLiveRestService({onEvent:event=>log.append(event,'Binance REST verified')});
    const futures=createLiveRestService({
      market:FUTURES_MARKET,allowedSymbol:symbol=>TRADFI_SYMBOLS.includes(symbol),
      alarms:false,refreshMs:10000,
    });
    server.middlewares.use('/api/futures-live-minute',async(req,res)=>{
      res.setHeader('Content-Type','application/json');
      res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){
        res.statusCode=405;
        res.end(JSON.stringify({error:'Method not allowed'}));
        return;
      }
      res.end(JSON.stringify(await futures(TRADFI_SYMBOLS)));
    });
    server.middlewares.use('/api/spot-live-minute',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      const requested=String(new URL(req.url,'http://localhost').searchParams.get('symbols')||'').split(',').filter(Boolean);
      res.end(JSON.stringify(await service(requested.length?requested:COINS)));
    });
  }
  return {name:'spot-live-rest-fallback',configureServer:attach,configurePreviewServer:attach};
}
