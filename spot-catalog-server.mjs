import {COINS} from './src/netflow/netflow.js';
import {fetchBinanceMarket,SPOT_MARKET} from './binance-market-data.mjs';
import {createDepthService} from './liquidity-depth-server.mjs';
import {createNetflowService} from './spot-netflow-server.mjs';
import {createLiveRestService} from './spot-live-rest-server.mjs';

const PAGE_SIZE=6;
const CATALOG_TTL=15*60*1000;

export function createSpotCatalog({fetcher=fetch,clock=Date.now}={}){
  let entries,updatedAt,retryAt=0,pending;
  return async()=>{
    if(pending)return pending;
    if((entries&&clock()-updatedAt<CATALOG_TTL)||clock()<retryAt){
      return {symbols:entries??[],stale:clock()<retryAt};
    }
    pending=(async()=>{
      try{
        const body=await fetchBinanceMarket(SPOT_MARKET,'/exchangeInfo?showPermissionSets=false',{fetcher,clock});
        if(!Array.isArray(body.symbols))throw Error('Missing exchange symbols');
        const available=body.symbols.filter(pair=>
          pair.status==='TRADING'&&pair.isSpotTradingAllowed&&pair.quoteAsset==='USDT'&&
          typeof pair.baseAsset==='string'&&pair.baseAsset.length>0&&pair.symbol===pair.baseAsset+'USDT'
        ).map(pair=>pair.baseAsset);
        if(!available.length)throw Error('No active USDT pairs');
        entries=[...new Set(available)].sort((a,b)=>a.localeCompare(b,'en'));
        updatedAt=clock();
        retryAt=0;
        return {symbols:entries,stale:false};
      }catch{
        retryAt=clock()+30000;
        return {symbols:entries??[],stale:true};
      }finally{
        pending=null;
      }
    })();
    return pending;
  };
}

function send(res,data,status=200){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}

export function spotCatalogPlugin(){
  function attach(server){
    const catalog=createSpotCatalog();
    const services=new Map();
    let activeRequests=0;
    function forSymbol(symbol){
      let service=services.get(symbol);
      if(!service){
        const symbols=()=>[symbol];
        service={
          depth:createDepthService({symbols,limit:100}),
          history:createNetflowService({symbols,includeCaps:false}),
          live:createLiveRestService({allowedSymbol:value=>value===symbol,alarms:false,refreshMs:10000}),
        };
      }
      services.delete(symbol);
      services.set(symbol,service);
      if(services.size>30)services.delete(services.keys().next().value);
      return service;
    }
    server.middlewares.use('/api/spot-catalog',async(req,res)=>{
      if(req.method!=='GET')return send(res,{error:'Method not allowed'},405);
      return send(res,await catalog());
    });
    server.middlewares.use('/api/spot-catalog-data',async(req,res)=>{
      if(req.method!=='GET')return send(res,{error:'Method not allowed'},405);
      const requested=[...new Set(new URL(req.url,'http://localhost').searchParams.getAll('symbol'))];
      if(!requested.length||requested.length>PAGE_SIZE)return send(res,{error:'Invalid symbol count'},400);
      if(activeRequests>=2)return send(res,{error:'Market data busy. Retrying automatically.'},503);
      activeRequests++;
      try{
        const {symbols}=await catalog();
        const allowed=new Set(symbols);
        if(requested.some(symbol=>!allowed.has(symbol)||COINS.includes(symbol))){
          return send(res,{error:'Unsupported market'},400);
        }
        const rows=await Promise.all(requested.map(async symbol=>{
          const service=forSymbol(symbol);
          const [depth,history,live]=await Promise.all([service.depth(),service.history(),service.live([symbol])]);
          return {
            symbol,
            book:depth.rows[0],
            history:{...history.rows[0],stale:history.stale||Date.now()-history.rows[0]?.asOf>90000},
            stream:live.rows[0],
          };
        }));
        return send(res,{rows});
      }catch{
        return send(res,{error:'Market data unavailable'},503);
      }finally{
        activeRequests--;
      }
    });
  }
  return {name:'spot-catalog',configureServer:attach,configurePreviewServer:attach};
}
