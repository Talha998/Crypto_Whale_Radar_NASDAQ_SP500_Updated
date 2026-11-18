import {COINS} from './src/netflow/netflow.js';
import {summarizeDepth} from './src/netflow/depthMath.js';
export function createDepthService({fetcher=fetch,clock=Date.now}={}){
 let cached,pending,lastAttempt=0,blockedUntil=0;
 async function coin(symbol){let failure;
  for(const host of ['https://data-api.binance.vision','https://api.binance.com']){
   try{if(clock()<blockedUntil)throw Error('Rate limit cooldown');
    const r=await fetcher(`${host}/api/v3/depth?symbol=${symbol}USDT&limit=1000`,{signal:AbortSignal.timeout(12000)});
    if(r.status===429||r.status===418){blockedUntil=clock()+Math.max(60000,(Number(r.headers?.get?.('retry-after'))||60)*1000);throw Error('Rate limit cooldown');}
    if(!r.ok)throw Error('Depth provider unavailable');
    return {symbol,...summarizeDepth(await r.json()),fetchedAt:clock(),stale:false};
   }catch(e){failure=e;if(clock()<blockedUntil)break;}
  }throw failure;
 }
 return async()=>{
  if(cached&&clock()-lastAttempt<10000)return cached;if(pending)return pending;lastAttempt=clock();
  pending=Promise.allSettled(COINS.map(coin)).then(results=>{
   const rows=results.map((r,i)=>r.status==='fulfilled'?r.value:{...(cached?.rows.find(x=>x.symbol===COINS[i])||{}),symbol:COINS[i],stale:true,error:'Order book unavailable'});
   cached={rows,fetchedAt:clock(),refreshSeconds:10,source:'Binance Spot USDT · REST book snapshots',stale:rows.every(r=>r.stale)};return cached;
  }).finally(()=>pending=null);return pending;
 };
}
export function liquidityDepthPlugin(){function attach(server){const service=createDepthService();server.middlewares.use('/api/spot-depth',async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}try{res.end(JSON.stringify(await service()));}catch{res.statusCode=503;res.end(JSON.stringify({error:'Depth unavailable'}));}});}return {name:'spot-liquidity-depth',configureServer:attach,configurePreviewServer:attach};}
