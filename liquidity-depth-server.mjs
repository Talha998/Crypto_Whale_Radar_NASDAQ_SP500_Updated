import {COINS} from './src/netflow/netflow.js';
import {summarizeDepth} from './src/netflow/depthMath.js';
import {TRADFI_SYMBOLS} from './src/netflow/tradFiMarkets.js';
import {currentDailyMoverSymbols} from './daily-movers-server.mjs';
import {fetchBinanceMarket, SPOT_MARKET, FUTURES_MARKET} from './binance-market-data.mjs';

export function createDepthService({fetcher=fetch,clock=Date.now,market=SPOT_MARKET,symbols=()=>COINS,limit=1000}={}){
  let cached,pending,cacheKey,lastAttempt;
  return async()=>{
    const requested=symbols();
    const key=requested.join(',');
    if(!requested.length)return {rows:[]};
    if(pending)return pending;
    if(cached && cacheKey===key && clock()-lastAttempt<10000)return cached;
    lastAttempt=clock();
    pending=Promise.allSettled(requested.map(async symbol=>{
      const book=await fetchBinanceMarket(market,`/depth?symbol=${symbol}USDT&limit=${limit}`,{fetcher,clock});
      return {symbol,...summarizeDepth(book,limit),fetchedAt:clock(),stale:false};
    })).then(results=>{
      const rows=results.map((result,index)=>{
        const symbol=requested[index];
        if(result.status==='fulfilled')return result.value;
        const previous=cached?.rows.find(row=>row.symbol===symbol);
        return {...previous,symbol,stale:true,error:'Order book unavailable'};
      });
      cacheKey=key;
      cached={rows,fetchedAt:clock(),refreshSeconds:10,stale:rows.every(row=>row.stale)};
      return cached;
    }).finally(()=>{pending=null;});
    return pending;
  };
}

export function liquidityDepthPlugin(){
  function attach(server){
    const core=createDepthService();
    const movers=createDepthService({symbols:currentDailyMoverSymbols,limit:500});
    const futures=createDepthService({market:FUTURES_MARKET,symbols:()=>TRADFI_SYMBOLS});
    server.middlewares.use('/api/spot-depth',async(req,res)=>{
      res.setHeader('Content-Type','application/json');
      res.setHeader('Cache-Control','no-store');
      if(req.method!=='GET'){
        res.statusCode=405;
        res.end(JSON.stringify({error:'Method not allowed'}));
        return;
      }
      try{
        const [spot,daily,tradFi]=await Promise.all([core(),movers(),futures()]);
        res.end(JSON.stringify({...spot,rows:[...spot.rows,...daily.rows],futuresRows:tradFi.rows}));
      }catch{
        res.statusCode=503;
        res.end(JSON.stringify({error:'Depth unavailable'}));
      }
    });
  }
  return {name:'spot-liquidity-depth',configureServer:attach,configurePreviewServer:attach};
}
