import {thresholdFor} from './coinThresholds.js';
import {useEffect,useRef,useState} from 'react';
import {COINS} from './netflow.js';
import {LiveMinuteFlow} from './liveMinuteFlow.js';
const STORAGE='spot-minute-flow-events-v1';
const LOG_PENDING='spot-netflow-pending-log-v1';
const HOSTS=['wss://data-stream.binance.vision/stream','wss://stream.binance.com:443/stream','wss://stream.binance.com:9443/stream'];
function loadEvents() {
  try {const saved=JSON.parse(localStorage.getItem(STORAGE)||'[]');return Array.isArray(saved)?saved.filter(x=>Number.isFinite(x.thresholdUSDT??thresholdFor(x.symbol))&&['BUY','SELL'].includes(x.side)&&Number.isFinite(x.time)&&Number.isFinite(x.net)&&Math.abs(x.net)>=(x.thresholdUSDT??thresholdFor(x.symbol))).slice(0,100):[];}catch{return [];}
}
export default function useLiveMinuteFlow(onLiveEvent,additionalSymbols=[]) {
  const symbolKey=[...new Set(additionalSymbols)].sort().join(',');
  const callback=useRef(onLiveEvent);
  useEffect(()=>{callback.current=onLiveEvent;},[onLiveEvent]);
  const [view,setView]=useState({status:'connecting',rows:[],lastMessage:null,transport:'connecting'});
  const [events,setEvents]=useState(loadEvents),[storageError,setStorageError]=useState(false),[logError,setLogError]=useState(''),[logRevision,setLogRevision]=useState(0);
  useEffect(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(events));setStorageError(false);}catch{setStorageError(true);}},[events]);
  useEffect(()=>{
    let stopped=false,socket,retry,timer,pollTimer,handshake,status='connecting',lastMessage=null,attempt=0,openedAt=0,rest=null,restBusy=false,restController,restError='';
    const pendingLogs=new Map();let logBusy=false;
    try{const saved=JSON.parse(localStorage.getItem(LOG_PENDING)||'[]');if(Array.isArray(saved))saved.forEach(e=>{if(e?.id)pendingLogs.set(e.id,e);});}catch{/* Storage unavailable: retry in memory. */}
    const persistPending=()=>{try{localStorage.setItem(LOG_PENDING,JSON.stringify([...pendingLogs.values()]));}catch{setLogError('Pending log could not be retained for a browser restart.');}};
    async function flushLogs(){
      if(stopped||logBusy||!pendingLogs.size)return;logBusy=true;
      try{
        for(const [id,event]of pendingLogs){
          if(stopped)break;
          const res=await fetch('/api/spot-netflow-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(10000)});
          if(!res.ok)throw Error('save failed');
          const body=await res.json();if(body.saved!==true&&body.duplicate!==true)throw Error('save not confirmed');
          pendingLogs.delete(id);persistPending();if(!stopped){setLogError('');setLogRevision(v=>v+1);}
        }
      }catch{if(!stopped)setLogError('Log save pending: retrying automatically. Keep the page open.');}
      finally{logBusy=false;}
    }
    const symbols=[...new Set([...COINS,...symbolKey.split(',').filter(Boolean)])];
    const restored=loadEvents();
    const engine=new LiveMinuteFlow(Date.now(),symbols),seen=new Set(restored.map(e=>e.id)),lastEvent=new Map();
    restored.forEach(e=>{const key=e.symbol+'-'+e.side;lastEvent.set(key,Math.max(e.time,lastEvent.get(key)??-Infinity));});
    function record(event) {
      if(!event||seen.has(event.id))return;seen.add(event.id);
      const key=event.symbol+'-'+event.side;
      if(event.time-(lastEvent.get(key)??-Infinity)<60000)return;
      lastEvent.set(key,event.time);
      pendingLogs.set(event.id,event);persistPending();flushLogs();
      setEvents(old=>old.some(x=>x.id===event.id||x.symbol===event.symbol&&x.side===event.side&&Math.abs(x.time-event.time)<60000)?old:[event,...old].slice(0,100));
      // Invoke outside React state updaters: Strict Mode must not replay sound.
      if(Date.now()-event.time<=15000&&event.time<=Date.now()+2000)callback.current?.(event);
    }
    function publish() {
      if(stopped)return;
      const now=Date.now(),wsHealthy=status==='live'&&lastMessage!==null&&now-lastMessage<15000;
      const streamRows=engine.snapshot(now);
      const allReady=wsHealthy&&streamRows.every(r=>r.ready&&r.lastTrade!==null);
      // REST bootstraps a verified complete minute immediately while WS warms up.
      const restHealthy=rest&&!rest.stale&&now-rest.receivedAt+(rest.ageMs||0)<15000;
      if(wsHealthy)streamRows.forEach(r=>record(r.event));
      if(allReady || wsHealthy&&!restHealthy) {
        setView({status:'live',rows:streamRows,lastMessage,transport:'WebSocket',error:''});
      } else if(restHealthy) {
        rest.events?.slice().reverse().forEach(record);
        // Latest trade price may be streamed even while the rolling WS minute warms up.
        const rows=rest.rows.map(row=>{
          const live=streamRows.find(r=>r.symbol===row.symbol);
          return wsHealthy&&live?.lastTrade>row.lastTrade?{...row,price:live.price,lastTrade:live.lastTrade}:row;
        });
        setView({status:'live',rows,lastMessage:rest.receivedAt,transport:'REST · 3s',error:restError});
      } else {
        const rows=rest?.rows||streamRows;
        setView({status:status==='connecting'?'connecting':'offline',rows,lastMessage:rest?.receivedAt??lastMessage,transport:'reconnecting',error:restError||rest?.error||''});
      }
      if(status==='live'&&now-(lastMessage??openedAt)>20000)socket?.close();
    }
    async function poll() {
      if(stopped||restBusy)return;
      // Once all WebSocket windows are complete, poll only as a standby health check.
      const wsComplete=status==='live'&&lastMessage&&Date.now()-lastMessage<15000&&[...engine.states.values()].every(r=>Date.now()-r.start>=60000&&r.lastTrade!==null);
      if(wsComplete&&rest&&Date.now()-rest.receivedAt<15000)return;
      restBusy=true;const ctrl=new AbortController();restController=ctrl;
      const timeout=setTimeout(()=>ctrl.abort(),45000);
      try {
        const response=await fetch(`/api/spot-live-minute?symbols=${encodeURIComponent(symbols.join(','))}`,{signal:ctrl.signal});
        if(!response.ok)throw Error('Live REST endpoint unavailable');
        const body=await response.json();
        if(!Array.isArray(body.rows))throw Error('Invalid live REST response');
        if(!stopped){rest={...body,receivedAt:Date.now()};restError=body.error||'';publish();}
      }catch {if(!stopped){restError='Live fallback request failed. Restart the updated Node server and check internet access.';publish();}}
      finally {clearTimeout(timeout);restBusy=false;}
    }
    function connect() {
      if(stopped)return;status='connecting';engine.reset(Date.now());lastMessage=null;publish();
      const streams=symbols.map(s=>`${s.toLowerCase()}usdt@aggTrade`).join('/');
      try {socket=new WebSocket(`${HOSTS[attempt%HOSTS.length]}?streams=${streams}`);}catch{status='offline';attempt++;retry=setTimeout(connect,3000);publish();return;}
      handshake=setTimeout(()=>socket?.close(),8000);
      socket.onopen=()=>{clearTimeout(handshake);if(stopped)return;status='live';openedAt=Date.now();engine.reset(openedAt);publish();};
      socket.onmessage=message=>{
        if(stopped)return;
        try {const trade=JSON.parse(message.data).data;if(trade?.e!=='aggTrade')return;lastMessage=Date.now();const row=engine.ingest(trade,lastMessage);record(row?.event);}catch{/* Invalid frames are ignored. */}
      };
      socket.onerror=()=>socket.close();
      socket.onclose=()=>{clearTimeout(handshake);if(stopped)return;status='offline';publish();attempt++;retry=setTimeout(connect,Math.min(1000*2**Math.min(attempt,4),15000));poll();};
    }
    connect();poll();flushLogs();timer=setInterval(publish,250);pollTimer=setInterval(()=>{poll();flushLogs();},3000);
    return()=>{stopped=true;clearTimeout(retry);clearTimeout(handshake);clearInterval(timer);clearInterval(pollTimer);restController?.abort();if(socket){socket.onclose=null;socket.close();}};
  },[symbolKey]);
  return {...view,events,storageError,logError,logRevision,clearEvents:()=>setEvents([])};
}
