import {isDailyMover,setDailyMoverSymbols} from './src/netflow/coinThresholds.js';
import {COINS} from './src/netflow/netflow.js';

const EXCLUDED=new Set('USDT USDC BUSD FDUSD TUSD USDP DAI USDE EUR USDTBRL USDTTRY BTC ETH BNB SOL XRP ADA DOGE TRX TON BCH LTC AVAX DOT LINK XLM HYPE SUI SHIB'.split(' '));
const LEVERAGED=/(UP|DOWN|BULL|BEAR|[23]L|[23]S)$/;
let cache=null;
function pktDate(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function selectDailyMovers(tickers,now=Date.now(),minimumQuoteVolume=10_000_000){
 const rows=tickers.filter(t=>typeof t.symbol==='string'&&t.symbol.endsWith('USDT')&&t.symbol.length>4&&Number.isFinite(Number(t.priceChangePercent))&&Number.isFinite(Number(t.quoteVolume))&&Number(t.quoteVolume)>=minimumQuoteVolume)
  .map(t=>({symbol:t.symbol.slice(0,-4),changePct:Number(t.priceChangePercent),quoteVolume:Number(t.quoteVolume)}))
  .filter(x=>!EXCLUDED.has(x.symbol)&&!COINS.includes(x.symbol)&&!LEVERAGED.test(x.symbol)&&/^[A-Z0-9]{2,15}$/.test(x.symbol));
 const gainers=rows.filter(x=>x.changePct>0).sort((a,b)=>b.changePct-a.changePct).slice(0,5).map(x=>({...x,side:'GAINER'}));
 const losers=rows.filter(x=>x.changePct<0).sort((a,b)=>a.changePct-b.changePct).slice(0,5).map(x=>({...x,side:'LOSER'}));
 return [...gainers,...losers].map(x=>({...x,thresholdUSDT:2_000_000}));
}
export function isCurrentDailyMover(symbol){return isDailyMover(symbol);}
export function createDailyMoversService({fetcher=fetch,clock=Date.now}={}){
 return async()=>{
  const now=clock(),datePKT=pktDate(now);
  if(cache?.datePKT===datePKT)return cache;
  let lastError;
  for(const host of ['https://data-api.binance.vision','https://api.binance.com'])try{
   const response=await fetcher(`${host}/api/v3/ticker/24hr`,{signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error(`Binance HTTP ${response.status}`);
   const payload=await response.json();if(!Array.isArray(payload))throw Error('Invalid 24-hour ticker response');
   const movers=selectDailyMovers(payload,now);if(movers.length<10)throw Error('Fewer than 10 liquid daily movers were available');
   setDailyMoverSymbols(movers.map(x=>x.symbol));
   cache={datePKT,movers,updatedAt:now,minimumQuoteVolumeUSDT:10_000_000,source:'Binance USDT 24-hour market statistics'};return cache;
  }catch(error){lastError=error;}
  if(cache){setDailyMoverSymbols(cache.movers.map(x=>x.symbol));return {...cache,stale:true,error:'Today’s refresh failed; showing the last successful daily list.'};}
  throw lastError||Error('Daily movers unavailable');
 };
}
export function dailyMoversPlugin(){function attach(server){const service=createDailyMoversService();server.middlewares.use('/api/spot-movers',async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}try{res.end(JSON.stringify(await service()));}catch{res.statusCode=503;res.end(JSON.stringify({error:'Daily movers temporarily unavailable. Check Binance access and retry.'}));}});}return {name:'daily-spot-movers',configureServer:attach,configurePreviewServer:attach};}
