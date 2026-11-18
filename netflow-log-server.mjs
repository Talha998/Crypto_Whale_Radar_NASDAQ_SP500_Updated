import {thresholdFor} from './src/netflow/coinThresholds.js';
import {appendFile,mkdir,open,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {COINS} from './src/netflow/netflow.js';
import {isCurrentDailyMover} from './daily-movers-server.mjs';

export function logEntry(event,source='Browser WebSocket',now=Date.now()) {
  if(!event||typeof event.id!=='string'||event.id.length>180||! /^[A-Za-z0-9._:-]+$/.test(event.id)||!(COINS.includes(event.symbol)||isCurrentDailyMover(event.symbol))||event.windowSeconds!==60||!Number.isFinite(event.net)||Math.abs(event.net)<thresholdFor(event.symbol)||Math.abs(event.net)>1e15||!Number.isFinite(event.price)||event.price<=0||!Number.isFinite(event.time)||event.time<Date.UTC(2000,0,1)||event.time>now+300000)throw Error('Invalid coin-threshold netflow log event');
  if(!['Browser WebSocket','Browser event relay','Binance REST verified'].includes(source))source='Browser WebSocket';
  const side=event.net>0?'BUY':'SELL';if(event.side!==side)throw Error('Invalid flow direction');
  const date=new Date(event.time);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).formatToParts(date).map(x=>[x.type,x.value]));
  return {id:event.id,symbol:event.symbol,side,thresholdUSDT:thresholdFor(event.symbol),net:event.net,price:event.price,windowSeconds:60,time:event.time,utc:date.toISOString(),datePKT:`${parts.year}-${parts.month}-${parts.day}`,timePKT:`${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod.toUpperCase()}`,timezone:'Asia/Karachi',source};
}
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
export const LOG_CSV_HEADER='Date (PKT),Time (PKT),Coin,Direction,Netflow (USDT),Price (USDT),Window (seconds),UTC,Source,Event ID,Threshold (USDT)\r\n';
function pktClock(ms){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Karachi',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).formatToParts(ms).map(x=>[x.type,x.value]));return `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod.toUpperCase()}`;}
export function logCsvRow(e) {return [e.datePKT,pktClock(e.time),e.symbol,e.side,e.net,e.price,60,e.utc,e.source,e.id,e.thresholdUSDT??5000000].map(csvCell).join(',')+'\r\n';}
export function createNetflowLog({file=resolve('logs/spot-netflow.jsonl'),clock=Date.now}={}) {
  let recent=[],queue=Promise.resolve(),lastError='',initError,needsNewline=false;
  const ids=new Set(),last=new Map();
  function remember(entry) {
    ids.add(entry.id);if(ids.size>50000)ids.delete(ids.values().next().value);
    const key=entry.symbol+'-'+entry.side;
    if(!last.has(key)||last.get(key).time<=entry.time)last.set(key,entry);
    recent.push(entry);if(recent.length>2000)recent.shift();
  }
  const ready=(async()=>{
    let handle;
    try {
      handle=await open(file,'r');const {size}=await handle.stat(),length=Math.min(size,4*1024*1024),buffer=Buffer.alloc(length);
      await handle.read(buffer,0,length,size-length);
      needsNewline=length>0&&buffer[length-1]!==10;
      const lines=buffer.toString('utf8').split('\n');if(size>length)lines.shift();
      for(const line of lines) {try{const e=JSON.parse(line);if(e.id&&COINS.includes(e.symbol)&&Number.isFinite(e.time)&&Number.isFinite(e.net)&&Math.abs(e.net)>=thresholdFor(e.symbol))remember(e);}catch{/* Skip a partial/corrupt line, preserving subsequent valid records. */}}
    }catch(e){if(e.code!=='ENOENT'){initError=e;lastError='Cannot read saved netflow log';}}
    finally{await handle?.close();}
  })();
  function append(event,source='Browser WebSocket') {
    const run=queue.then(async()=>{
      await ready;if(initError)throw initError;
      const entry=logEntry(event,source,clock());
      const previous=last.get(entry.symbol+'-'+entry.side);
      if(ids.has(entry.id)||previous&&Math.abs(entry.time-previous.time)<60000)return {saved:false,duplicate:true};
      await mkdir(dirname(file),{recursive:true});
      await appendFile(file,(needsNewline?'\n':'')+JSON.stringify(entry)+'\n','utf8');
      needsNewline=false;
      remember(entry);lastError='';return {saved:true,entry};
    });
    queue=run.catch(()=>{lastError='Could not save netflow log. Check the server logs folder is writable.';});
    return run;
  }
  async function clear(){
    const run=queue.then(async()=>{
      await ready;if(initError)throw initError;
      await mkdir(dirname(file),{recursive:true});
      await writeFile(file,'','utf8');
      recent=[];ids.clear();last.clear();needsNewline=false;lastError='';
      return {cleared:true};
    });
    queue=run.catch(()=>{lastError='Could not clear saved netflow log. Check the server logs folder permissions.';});
    return run;
  }
  return {file,append,clear,async list(){await ready;await queue;return {entries:[...recent].sort((a,b)=>b.time-a.time).slice(0,200).map(e=>({...e,timePKT:pktClock(e.time)})),error:lastError,path:'logs/spot-netflow.jsonl'};},async *csv(){await ready;await queue;if(initError)throw initError;yield LOG_CSV_HEADER;let lines;
    try {lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});for await(const line of lines){try{const e=JSON.parse(line);if(COINS.includes(e.symbol)&&e.datePKT)yield logCsvRow(e);}catch{/* Ignore partial lines. */}}}
    catch(e){if(e.code!=='ENOENT')throw e;}finally{lines?.close();}
  }};
}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));}
export function attachNetflowLog(middlewares,log) {
  middlewares.use('/api/spot-netflow-log.csv',async(req,res)=>{
    if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="spot-netflow-log.csv"');res.setHeader('Cache-Control','no-store');
    try {for await(const chunk of log.csv()) {if(res.destroyed)break;res.write(chunk);}res.end();}catch{if(!res.headersSent)json(res,500,{error:'Log download unavailable'});else res.destroy();}
  });
  middlewares.use('/api/spot-netflow-log',async(req,res)=>{
    if(req.method==='GET'){try{json(res,200,await log.list());}catch{json(res,500,{error:'Log unavailable'});}return;}
    if(req.method==='DELETE'){try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){json(res,403,{error:'Origin not allowed'});return;}json(res,200,await log.clear());}catch{json(res,500,{error:'Could not clear saved netflow log'});}return;}
    if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return;}
    try {
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){json(res,403,{error:'Origin not allowed'});return;}
      let body='',bytes=0;
      for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>8192){json(res,413,{error:'Log event too large'});return;}body+=chunk;}
      let event;try{event=JSON.parse(body);logEntry(event);}catch{json(res,400,{error:'Invalid coin-threshold netflow event'});return;}
      const result=await log.append(event,'Browser event relay');json(res,200,result);
    }catch{json(res,500,{error:'Could not save netflow log'});}
  });
}
