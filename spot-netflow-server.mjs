import {loadEnv} from 'vite';
import {COINS, WINDOWS, candleFlow, normalizeCoinGlass, finite} from './src/netflow/netflow.js';

import {TRADFI_SYMBOLS} from './src/netflow/tradFiMarkets.js';
import {currentDailyMoverSymbols} from './daily-movers-server.mjs';
import {fetchBinanceMarket, SPOT_MARKET, FUTURES_MARKET} from './binance-market-data.mjs';

export function createNetflowService({
  key='', fetcher=fetch, clock=Date.now, market=SPOT_MARKET,
  symbols=()=>COINS, includeCaps=true,
}={}) {
  let cacheKey;
  let cached, pending, caps, capTime = 0;
  const hourly = new Map();
  async function get(url, headers = {}) {
    const response = await fetcher(url, {headers, signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    return response.json();
  }
  async function binance(symbol, interval, limit) {
    const bars=await fetchBinanceMarket(market,`/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`,{fetcher,clock});
    if(!Array.isArray(bars)||!bars.length)throw Error('Invalid market response');
    return bars;
  }
  async function refresh(requested) {
    const now = clock();
    if (key) {
      const all = [];
      for (let page = 1; page <= 20; page++) {
        const result = await get(`https://open-api-v4.coinglass.com/api/spot/netflow-list?per_page=200&page=${page}`, {'CG-API-KEY':key});
        if (String(result.code) !== '0' || !Array.isArray(result.data)) throw new Error('CoinGlass access unavailable; check API key and Startup or higher plan.');
        all.push(...result.data);
        if (!result.data.length || COINS.every(s => all.some(r => r.symbol === s))) break;
      }
      return {source:'CoinGlass · aggregated spot', rows:normalizeCoinGlass(all), fetchedAt:clock(), notice:'Rolling USD taker buying minus selling across CoinGlass covered exchanges.'};
    }
    const results = await Promise.allSettled(requested.map(async symbol => {
      const minute = await binance(symbol,'1m',1000);
      let history = hourly.get(symbol);
      if (!history || now-history.at > 240000 || Math.floor(history.at/3600000) !== Math.floor(now/3600000)) {
        try {
          history = {at:now, bars:await binance(symbol,'1h',721)};
          hourly.set(symbol,history);
        } catch { /* Recent minutes still support short windows. */ }
      }
      // Replace current hour with minute totals so the live bucket stays up to date.
      const asOf = Number(minute.at(-1)?.[0]);
      const hourStart = Math.floor(asOf/3600000)*3600000;
      const hour = minute.filter(c => Number(c[0]) >= hourStart);
      const bars = (history?.bars??[]).filter(c => Number(c[0]) < hourStart);
      if (hour.length === Math.floor((asOf-hourStart)/60000)+1) {
        const current = [hourStart]; current[7] = hour.reduce((s,c)=>s+Number(c[7]),0); current[10] = hour.reduce((s,c)=>s+Number(c[10]),0); bars.push(current);
      }
      // Use provider's minute boundary to avoid crossing a clock boundary during a request.
      return {symbol, asOf, values:Object.fromEntries(WINDOWS.map(([k,,m])=>[k,candleFlow(m<=720 ? minute : bars,m,asOf)]))};
    }));
    if (includeCaps && (!caps || now-capTime > 300000)) {
      try {
        const data = await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,binancecoin,usd-coin,ripple,solana');
        if (Array.isArray(data)) { caps = Object.fromEntries(data.map(d=>[d.symbol.toUpperCase(),finite(d.market_cap)])); capTime = clock(); }
      } catch { /* Market caps are optional; flow remains independent. */ }
    }
    const rows = results.map((r,i)=>r.status==='fulfilled' ? {...r.value,marketCap:caps?.[requested[i]] ?? null} : {symbol:requested[i],values:{},error:'Binance unavailable or pair unsupported'});
    if (results.every(r=>r.status==='rejected')) throw new Error('Binance Spot unavailable. Check internet access or regional restrictions.');
    return {source:market===FUTURES_MARKET?'Binance Futures · USDT perpetuals':'Binance Spot · USDT pairs',rows,fetchedAt:clock(),marketCapAt:capTime || null, notice:'Net taker buying − selling, quoted in USDT (≈ USD). Short windows use minute buckets; 24h–30d use hour buckets, including the current partial bucket. Binance only; not wallet deposits or withdrawals.'};
  }
  return async () => {
    const requested=symbols();
    const requestKey=requested.join(',');
    if(!requested.length)return {rows:[]};
    if(cached && cacheKey===requestKey && clock()-cached.fetchedAt<30000)return {...cached,stale:false};
    if(pending)return pending;
    pending=refresh(requested).then(data=>{
      cached=data;
      cacheKey=requestKey;
      for(const symbol of hourly.keys())if(!requested.includes(symbol))hourly.delete(symbol);
      return {...data,stale:false};
    }).catch(()=>{
      const error=key?'CoinGlass unavailable: check key, plan or connection.':'Binance history unavailable.';
      if(cached && cacheKey===requestKey)return {...cached,stale:true,error};
      return {source:key?'CoinGlass':'Binance',rows:requested.map(symbol=>({symbol,values:{}})),stale:true,error};
    }).finally(()=>{pending=null;});
    return pending;
  };
}

export function spotNetflowPlugin() {
  const attach = server => {
    const env = loadEnv(server.config.mode,process.cwd(),'');
    const service = createNetflowService({key:process.env.COINGLASS_API_KEY || env.COINGLASS_API_KEY || ''});
    const movers=createNetflowService({symbols:currentDailyMoverSymbols,includeCaps:false});
    const futures=createNetflowService({market:FUTURES_MARKET,symbols:()=>TRADFI_SYMBOLS,includeCaps:false});
    server.middlewares.use('/api/spot-netflow',async(req,res)=>{
      res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
      if (req.method !== 'GET') {res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      const [core,daily,tradFi]=await Promise.all([service(),movers(),futures()]);
      const markRows=result=>result.rows.map(row=>({
        ...row, stale:!!result.stale || !!row.error || (Number.isFinite(row.asOf) && Date.now()-row.asOf>90000),
      }));
      res.end(JSON.stringify({...core,rows:[...markRows(core),...markRows(daily)],futuresRows:markRows(tradFi)}));
    });
  };
  return {name:'spot-netflow',configureServer:attach,configurePreviewServer:attach};
}
