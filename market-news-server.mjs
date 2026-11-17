import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {newsImpact} from './src/news/newsImpact.js';
export const NEWS_FEEDS=[
 {id:'fed',name:'Federal Reserve · official',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',official:true},
 {id:'fed-speeches',name:'Fed speeches · official',url:'https://www.federalreserve.gov/feeds/speeches.xml',official:true},
 {id:'yahoo-markets',name:'Yahoo Finance · QQQ/SPY macro',url:'https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ%2CSPY&region=US&lang=en-US'},
 {id:'nvda',name:'Yahoo Finance · NVDA',url:'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US'},
 {id:'macro',name:'Google News · macro/tech index',url:'https://news.google.com/rss/search?q=Nvidia%20OR%20Nasdaq%20OR%20Federal%20Reserve%20OR%20inflation%20OR%20tariffs%20OR%20government%20shutdown%20when:1d&hl=en-US&gl=US&ceid=US:en',indexed:true},
 {id:'crypto',name:'Cointelegraph',url:'https://cointelegraph.com/rss'},
 {id:'coindesk',name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'},
 {id:'block',name:'The Block',url:'https://www.theblock.co/rss.xml'},
];
const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function clean(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi,(m,e)=>{if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return ENT[e.toLowerCase()]??m;}).replace(/\s+/g,' ').trim();}
function field(block,name){return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'';}
function safeURL(raw){try{const u=new URL(clean(raw));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.toString():null;}catch{return null;}}
export function parseNewsFeed(xml,feed){
 if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw Error('Invalid RSS/Atom response');
 const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0,100);
 return blocks.map(([,type,block])=>{
  const title=clean(field(block,'title')).slice(0,400);
  const href=type.toLowerCase()==='entry'?block.match(/<link\b(?=[^>]*(?:rel=["']alternate["']|href=))[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1]:field(block,'link');
  const url=safeURL(href),stamp=field(block,'pubDate')||field(block,'published')||field(block,'updated')||field(block,'dc:date');
  const time=Date.parse(clean(stamp));
  const publisher=clean(field(block,'source')).slice(0,100)||feed.name;
  if(!title||!url)return null;
  return {id:url,title,url,publisher,feed:feed.name,feedId:feed.id,official:!!feed.official,indexed:!!feed.indexed,publishedAt:Number.isFinite(time)?time:null};
 }).filter(Boolean);
}
function canonicalURL(url){const u=new URL(url);for(const key of [...u.searchParams.keys()])if(/^utm_|^(guccounter|guce_referrer|ocid|ref)$/i.test(key))u.searchParams.delete(key);u.hash='';return u.toString();}
export function mergeNews(previous,incoming,now){
 const byURL=new Map(previous.map(a=>[canonicalURL(a.url),a]));
 for(const item of incoming){if(item.publishedAt!==null&&item.publishedAt>now+300000)continue;const key=canonicalURL(item.url),old=byURL.get(key);byURL.set(key,{...item,url:key,id:key,firstSeen:old?.firstSeen??now,lastSeen:now,impact:newsImpact(item.title)});}
 const byTitle=new Map();
 for(const a of [...byURL.values()].sort((a,b)=>(a.firstSeen??now)-(b.firstSeen??now))){
  if((a.publishedAt??a.firstSeen)<now-7*86400000)continue;
  const title=a.title.toLowerCase().replace(/\s[-|]\s[^|]{1,70}$/,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const old=byTitle.get(title);
  if(!old||a.official&&!old.official)byTitle.set(title,a);
 }
 return [...byTitle.values()].sort((a,b)=>(b.publishedAt??b.firstSeen)-(a.publishedAt??a.firstSeen)).slice(0,1000);
}
export function createNewsService({fetcher=fetch,clock=Date.now,file=resolve('logs/market-news.json'),feeds=NEWS_FEEDS}={}){
 let archive=[],cached,pending,lastAttempt=0,storageError='',archiveReadFailed=false;
 const ready=readFile(file,'utf8').then(t=>{const parsed=JSON.parse(t);if(Array.isArray(parsed))archive=parsed.filter(a=>a.title&&safeURL(a.url));else throw Error();}).catch(e=>{if(e.code!=='ENOENT'){archiveReadFailed=true;storageError='News archive could not be read; the live feed is still available and the old file is retained.';}});
 async function download(feed){
  const res=await fetcher(feed.url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9','User-Agent':'CryptoMarketNewsMonitor/1.0'}});
  if(!res.ok)throw Error(`HTTP ${res.status}`);
  let text='';if(res.body?.getReader){const reader=res.body.getReader();let bytes=0;const decoder=new TextDecoder();try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2*1024*1024)throw Error('Feed too large');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}else{text=await res.text();if(text.length>2*1024*1024)throw Error('Feed too large');}
  return parseNewsFeed(text,feed);
 }
 async function refresh(){
  await ready;const results=await Promise.allSettled(feeds.map(download)),now=clock();
  const sources=results.map((r,i)=>({id:feeds[i].id,name:feeds[i].name,status:r.status==='fulfilled'?'ok':'unavailable',count:r.status==='fulfilled'?r.value.length:0,checkedAt:now,error:r.status==='rejected'?'Feed blocked, timed out or unavailable':''}));
  const incoming=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);archive=mergeNews(archive,incoming,now);
  try{if(archiveReadFailed)throw Error('Unreadable archive retained');await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',JSON.stringify(archive),'utf8');await rename(file+'.tmp',file);storageError='';}catch{storageError=archiveReadFailed?'News archive unreadable; original file retained. New first-seen history is in memory only.':'Could not save news archive; first-seen history may not survive restart.';}
  return {articles:archive,sources,fetchedAt:now,refreshSeconds:120,stale:sources.every(s=>s.status!=='ok'),storageError,notice:'Headline-based possible impact; not verified causation, a trading signal or a win probability. Publisher timestamps and local first-seen times are different.'};
 }
 return async()=>{if(cached&&clock()-lastAttempt<120000)return cached;if(pending)return pending;lastAttempt=clock();pending=refresh().then(x=>cached=x).finally(()=>pending=null);return pending;};
}
export function marketNewsPlugin(){function attach(server){const service=createNewsService();server.middlewares.use('/api/market-news',async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return;}try{res.end(JSON.stringify(await service()));}catch{res.statusCode=503;res.end(JSON.stringify({error:'Market news temporarily unavailable'}));}});}return {name:'market-news-impact',configureServer:attach,configurePreviewServer:attach};}
