import React,{useEffect,useState} from 'react';
import {COINS,usd} from './netflow.js';
import {livePrice} from './liveMinuteFlow.js';
export default function NetflowLogPanel({revision=0}) {
  const [entries,setEntries]=useState([]),[error,setError]=useState(''),[coin,setCoin]=useState('ALL'),[updated,setUpdated]=useState(null);
  useEffect(()=>{
    let stopped=false,busy=false,controller;
    async function read(){
      if(busy||stopped)return;busy=true;const ctrl=new AbortController();controller=ctrl;const timer=setTimeout(()=>ctrl.abort(),12000);
      try{const res=await fetch('/api/spot-netflow-log',{signal:ctrl.signal});if(!res.ok)throw Error();const body=await res.json();if(!Array.isArray(body.entries))throw Error();if(!stopped){setEntries(body.entries);setError(body.error||'');setUpdated(Date.now());}}
      catch{if(!stopped)setError('Saved log unavailable. Restart the updated server; check logs folder permissions.');}
      finally{busy=false;clearTimeout(timer);}
    }
    read();const timer=setInterval(read,5000);return()=>{stopped=true;clearInterval(timer);controller?.abort();};
  },[revision]);
  const rows=entries.filter(e=>coin==='ALL'||e.symbol===coin);
  return <div className="netflow-saved-log"><div className="netflow-event-heading"><h3>Saved $5M+ netflow log · 1 minute</h3><div className="netflow-log-actions"><select aria-label="Filter saved log by coin" value={coin} onChange={e=>setCoin(e.target.value)}><option value="ALL">All coins</option>{COINS.map(c=><option key={c}>{c}</option>)}</select><a href="/api/spot-netflow-log.csv" download="spot-netflow-log.csv">Download full CSV</a></div></div><p>Saved on this server · Latest 200 records · CSV includes the complete saved file. Clearing live events does not delete these logs.</p>
    {error&&<p role="status" className="netflow-warning">{error}</p>}
    {!rows.length?<p>{updated?'No saved $5M+ events for this selection yet.':'Loading saved logs…'}</p>:<div className="netflow-scroll"><table><thead><tr><th>Date · PKT</th><th>Time · PKT</th><th>Coin</th><th>Direction</th><th>1-minute netflow</th><th>Price · USDT</th><th>Source</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td>{e.datePKT}</td><td>{e.timePKT}</td><td><b>{e.symbol}</b></td><td>{e.side==='BUY'?'NET BUYING':'NET SELLING'}</td><td className={e.net>0?'flow-positive':'flow-negative'}>{usd(e.net)}</td><td>{livePrice(e.price)}</td><td>{e.source}</td></tr>)}</tbody></table></div>}
  </div>;
}
