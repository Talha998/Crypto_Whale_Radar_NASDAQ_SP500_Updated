import {loadEnv} from 'vite';
import {COINS, WINDOWS, candleFlow, normalizeCoinGlass, finite} from './src/netflow/netflow.js';

export function createNetflowService({key = '', fetcher = fetch, clock = Date.now} = {}) {
  let cached, pending, caps, capTime = 0;
  const hourly = new Map();
  async function get(url, headers = {}) {
    const response = await fetcher(url, {headers, signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    return response.json();
  }
  async function binance(symbol, interval, limit) {
    let last;
    for (const host of ['https://data-api.binance.vision','https://api.binance.com']) {
      try {
        const bars = await get(`${host}/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
        if (!Array.isArray(bars)) throw new Error('Invalid market response');
        return bars;
      } catch (e) { last = e; }
    }
    throw last;
  }
  async function refresh() {
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
    const results = await Promise.allSettled(COINS.map(async symbol => {
      const minute = await binance(symbol,'1m',1000);
      let history = hourly.get(symbol);
      if (!history || now-history.at > 240000 || Math.floor(history.at/3600000) !== Math.floor(now/3600000)) {
        history = {at:now, bars:await binance(symbol,'1h',721)};
        hourly.set(symbol,history);
      }
      // Replace current hour with minute totals so the live bucket stays up to date.
      const asOf = Number(minute.at(-1)?.[0]);
      const hourStart = Math.floor(asOf/3600000)*3600000;
      const hour = minute.filter(c => Number(c[0]) >= hourStart);
      const bars = history.bars.filter(c => Number(c[0]) < hourStart);
      if (hour.length === Math.floor((asOf-hourStart)/60000)+1) {
        const current = [hourStart]; current[7] = hour.reduce((s,c)=>s+Number(c[7]),0); current[10] = hour.reduce((s,c)=>s+Number(c[10]),0); bars.push(current);
      }
      // Use provider's minute boundary to avoid crossing a clock boundary during a request.
      return {symbol, asOf, values:Object.fromEntries(WINDOWS.map(([k,,m])=>[k,candleFlow(m<=720 ? minute : bars,m,asOf)]))};
    }));
    if (!caps || now-capTime > 300000) {
      try {
        const data = await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,binancecoin,usd-coin,ripple');
        if (Array.isArray(data)) { caps = Object.fromEntries(data.map(d=>[d.symbol.toUpperCase(),finite(d.market_cap)])); capTime = clock(); }
      } catch { /* Market caps are optional; flow remains independent. */ }
    }
    const rows = results.map((r,i)=>r.status==='fulfilled' ? {...r.value,marketCap:caps?.[COINS[i]] ?? null} : {symbol:COINS[i],values:{},error:'Binance unavailable or pair unsupported'});
    if (results.every(r=>r.status==='rejected')) throw new Error('Binance Spot unavailable. Check internet access or regional restrictions.');
    return {source:'Binance Spot · USDT pairs',rows,fetchedAt:clock(),marketCapAt:capTime || null, notice:'Net taker buying − selling, quoted in USDT (≈ USD). Short windows use minute buckets; 24h–30d use hour buckets, including the current partial bucket. Binance only; not wallet deposits or withdrawals.'};
  }
  return async () => {
    if (cached && clock()-cached.fetchedAt < 30000) return {...cached,stale:false};
    if (pending) return pending;
    pending = refresh().then(data => { cached=data; return {...data,stale:false}; }).catch(() => cached ? {...cached,stale:true,error:key ? 'CoinGlass refresh failed; check key, plan or connection.' : 'Refresh failed; showing last successful values.'} : {source:key?'CoinGlass':'Binance Spot',rows:COINS.map(symbol=>({symbol,values:{}})),stale:true,error:key ? 'CoinGlass unavailable: check key and Startup or higher plan.' : 'Binance unavailable: check internet or regional restrictions.'}).finally(()=>{pending=null;});
    return pending;
  };
}
export function spotNetflowPlugin() {
  const attach = server => {
    const env = loadEnv(server.config.mode,process.cwd(),'');
    const service = createNetflowService({key:process.env.COINGLASS_API_KEY || env.COINGLASS_API_KEY || ''});
    server.middlewares.use('/api/spot-netflow',async(req,res)=>{
      res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
      if (req.method !== 'GET') {res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}
      res.end(JSON.stringify(await service()));
    });
  };
  return {name:'spot-netflow',configureServer:attach,configurePreviewServer:attach};
}
