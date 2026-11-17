import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {COINS} from './src/netflow/netflow.js';
import {STRATEGIES,RULES,parseBars,indicators,signalAt,backtest,qualified,openPaper,exitPaper,stats} from './src/paper/strategies.js';

export function createPaperService({fetcher=fetch,clock=Date.now,file=resolve('logs/paper-trading.json')}={}){
 const histories=new Map();let state={version:1,mode:'practice',minimum:80,running:true,accounts:{},orders:[]},pending,cache,at=0,storageError='',operation=Promise.resolve();
 const schedule=fn=>{const run=operation.then(fn);operation=run.catch(()=>{});return run;};
 const ready=readFile(file,'utf8').then(text=>{const saved=JSON.parse(text);if(saved.version!==1||!saved.accounts||!['qualified','practice'].includes(saved.mode)||![80,90].includes(saved.minimum))throw Error();state=saved;}).catch(e=>{if(e.code!=='ENOENT')storageError='Saved paper state could not be read. Trading paused to protect history.';});
 async function persist(){try{await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(state),'utf8');await rename(file+'.tmp',file);storageError='';}catch{storageError='Paper state could not be saved. Trading paused; check logs folder permissions.';}}
 async function bars(symbol){
  const now=clock(),old=histories.get(symbol),deadline=Date.now()+60000;let raw=[];
  const start=old?Math.max(now-7*86400000,old.at-120000):now-7*86400000;
  let cursor=start;
  for(let page=0;page<12;page++){
   let data,last;
   for(const host of ['https://data-api.binance.vision','https://api.binance.com']){
    try{if(Date.now()>=deadline)throw Error('History request timed out');const res=await fetcher(`${host}/api/v3/klines?symbol=${symbol}USDT&interval=1m&startTime=${cursor}&limit=1000`,{signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});if(!res.ok)throw Error('Candle API unavailable');data=await res.json();if(!Array.isArray(data))throw Error();break;}catch(e){last=e;}
   }
   if(!data)throw last;
   raw.push(...data);if(data.length<1000||Number(data.at(-1)[6])>=now)break;
   cursor=Number(data.at(-1)[0])+60000;
  }
  const merged=new Map((old?.raw||[]).map(k=>[Number(k[0]),k]));raw.forEach(k=>merged.set(Number(k[0]),k));
  const all=[...merged.values()].filter(k=>Number(k[0])>=now-7*86400000).sort((a,b)=>Number(a[0])-Number(b[0]));
  const parsed=parseBars(all,now),closed=parsed.filter(b=>b.end<now);
  if(closed.length<100||now-closed.at(-1).end>90000)throw Error('Fresh complete candle history unavailable');
  histories.set(symbol,{raw:all,at:now});return {closed,current:parsed.find(b=>b.time>closed.at(-1).time),features:indicators(closed)};
 }
 async function refresh(){
  await ready;
  const results=await Promise.allSettled(COINS.map(async symbol=>({symbol,...await bars(symbol)})));
  const rows=[];let changed=false;
  for(let c=0;c<COINS.length;c++){
   const r=results[c];if(r.status!=='fulfilled'){rows.push({symbol:COINS[c],error:'Strategy candles unavailable. No new entries.'});continue;}
   const {symbol,closed,current,features}=r.value,latest=closed.at(-1);
   for(const strategy of STRATEGIES){
    const key=symbol+'-'+strategy.id,result=backtest(strategy.id,closed,features),eligible=qualified(result,state.minimum);
    const account=state.accounts[key]??{balance:RULES.initial,position:null,lastBar:null,trades:[],lastSignal:null};
    const newBar=account.lastBar!==latest.time;
    // Resolve existing paper risk rules even when new entries are paused.
    if(account.position){
     for(const b of closed.filter(b=>b.time>=account.position.time&&b.time>(account.lastBar??-Infinity))){const exit=exitPaper(account.position,b);if(exit){account.balance+=exit.pnl;account.position=null;account.trades.push(exit);state.orders.unshift({id:key+'-exit-'+exit.exitTime,key,symbol,strategy:strategy.name,action:'CLOSE '+exit.side,...exit});changed=true;break;}}
    }
    const side=signalAt(strategy.id,closed,features,closed.length-1);
    if(!storageError&&state.running&&newBar&&!account.position&&side&&current&&current.time===latest.time+60000&&clock()-current.time<60000&&(state.mode==='practice'||eligible)&&account.balance>=RULES.stake*(1+RULES.fee)){
     account.position=openPaper(side,current.open,current.time);
     account.lastSignal=side;state.orders.unshift({id:key+'-entry-'+current.time,key,symbol,strategy:strategy.name,action:side==='BUY'?'OPEN LONG':'OPEN SHORT',...account.position});changed=true;
    }
    if(newBar){account.lastBar=latest.time;changed=true;}
    state.accounts[key]=account;
    rows.push({symbol,strategy:strategy.name,strategyId:strategy.id,result,eligible,signal:side,markPrice:current?.close??latest.close,account:{...account,trades:undefined,stats:stats(account.trades)},lastCandle:latest.end});
   }
  }
  state.orders=state.orders.slice(0,2000);
  if(changed&&!storageError)await persist();
  return {rows,mode:state.mode,minimum:state.minimum,running:state.running,rules:RULES,orders:state.orders.slice(0,200),fetchedAt:clock(),storageError};
 }
 async function get(){if(cache&&clock()-at<30000)return cache;if(pending)return pending;pending=schedule(refresh).then(data=>{cache=data;at=clock();return data;}).finally(()=>pending=null);return pending;}
 async function configure(config){if(pending)await pending;await schedule(async()=>{await ready;if(storageError)throw Error(storageError);if(config.mode!==undefined&&!['qualified','practice'].includes(config.mode))throw Error('Invalid mode');if(config.minimum!==undefined&&![80,90].includes(config.minimum))throw Error('Invalid minimum');if(config.running!==undefined&&typeof config.running!=='boolean')throw Error('Invalid running');Object.assign(state,config);await persist();cache=null;});return get();}
 return {get,configure};
}
export function paperTradingPlugin(){function attach(server){const service=createPaperService();server.middlewares.use('/api/paper-trading',async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');try{
 if(req.method==='GET'){res.end(JSON.stringify(await service.get()));return;}
 if(req.method==='POST'){
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){res.statusCode=403;res.end(JSON.stringify({error:'Origin not allowed'}));return;}
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>1024)throw Error('Request too large');}
  const input=JSON.parse(text),config={};for(const key of ['mode','minimum','running'])if(input[key]!==undefined)config[key]=input[key];res.end(JSON.stringify(await service.configure(config)));return;
 }
 res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));
 }catch{res.statusCode=503;res.end(JSON.stringify({error:'Paper simulator unavailable. No order was sent to an exchange.'}));}});}
 return {name:'virtual-paper-trading',configureServer:attach,configurePreviewServer:attach};}
