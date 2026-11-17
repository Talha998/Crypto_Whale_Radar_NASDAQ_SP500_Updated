import NetflowLogPanel from './NetflowLogPanel.jsx';
import React, {useEffect,useRef,useState} from 'react';
import {COINS,WINDOWS,usd} from './netflow.js';
import useLiveMinuteFlow from './useLiveMinuteFlow.js';
import {livePrice,pktDateTime} from './liveMinuteFlow.js';
import './netflow.css';
const DISPLAY_WINDOWS=[['1m','1 minute · live',1],...WINDOWS];
export default function SpotNetflowPanel({alarmEnabled=false,alarmMessage='',onEnableAlarm,onDisableAlarm,onTestAlarm,onNetflowAlarm}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(Date.now());
  const [selected,setSelected]=useState('1m');
  const [latestAlarm,setLatestAlarm]=useState(null);
  const live=useLiveMinuteFlow(event=>{setLatestAlarm(event);onNetflowAlarm?.(event);}),healthy=live.status==='live';
  const active=useRef(false),controller=useRef();
  const refresh=async()=>{
    if(active.current)return;active.current=true;setBusy(true);
    const ctrl=new AbortController();controller.current=ctrl;const timeout=setTimeout(()=>ctrl.abort(),90000);
    try {const res=await fetch('/api/spot-netflow',{signal:ctrl.signal});if(!res.ok)throw Error();const body=await res.json();if(!Array.isArray(body.rows))throw Error();if(!ctrl.signal.aborted){setData(body);setError('');}}
    catch {if(!ctrl.signal.aborted)setError('Historical windows unavailable. Retrying automatically.');}
    finally {clearTimeout(timeout);active.current=false;setBusy(false);}
  };
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000),age=setInterval(()=>setTick(Date.now()),1000);return()=>{clearInterval(timer);clearInterval(age);controller.current?.abort();};},[]);
  const stale=!!error||data?.stale||!data?.fetchedAt||tick-data.fetchedAt>90000;
  const rows=COINS.map(symbol=>{
    const historical=data?.rows.find(r=>r.symbol===symbol)||{symbol,values:{}};
    const stream=live.rows.find(r=>r.symbol===symbol);
    return {...historical,stream,values:{...historical.values,'1m':stream?.lastTrade?stream.net:null}};
  });
  const label=DISPLAY_WINDOWS.find(w=>w[0]===selected)?.[1];
  const cellStale=(row,key)=>key==='1m'?!healthy||!!row.stream?.stale:stale||!!row.error;
  return <section className="netflow-panel" aria-label="Cryptocurrency Spot Netflow Statistics">
    <div className="netflow-heading"><div><span className="netflow-eyebrow">SPOT MONEY FLOW · 5 COINS</span><h2>Cryptocurrency Spot Netflow Statistics</h2><p>Binance Spot · live USDT prices &amp; rolling 60-second flow <span className={`netflow-status ${healthy?'':'waiting'}`}>{healthy?`LIVE · ${live.transport}`:live.status.toUpperCase()}</span></p><p className="netflow-clock">{pktDateTime(tick)}</p></div><button onClick={refresh} disabled={busy}>{busy?'Updating history…':'Refresh history'}</button></div>
    <div className="netflow-alarm-controls"><div><b>1-minute $5M+ sound alarm · BUY &amp; SELL</b><small>Click Enable once to allow browser audio. Applies to BTC, ETH, BNB, USDC and XRP.</small></div><button type="button" className={alarmEnabled?'is-armed':''} onClick={alarmEnabled?onDisableAlarm:onEnableAlarm}>{alarmEnabled?'🔔 Alarm armed · Disable':'🔕 Enable alarm'}</button><button type="button" onClick={onTestAlarm}>Test sound</button><small role="status">{alarmMessage}</small></div>
    {latestAlarm&&<div role="alert" className={`netflow-alarm-banner ${latestAlarm.side==='SELL'?'negative':'positive'}`}><div><b>🔔 {latestAlarm.symbol} · 1-MINUTE {latestAlarm.side==='BUY'?'NET BUYING':'NET SELLING'} ALARM</b><strong>{usd(latestAlarm.net)}</strong><span>Price {livePrice(latestAlarm.price)} USDT · {pktDateTime(latestAlarm.time)}</span><small>{alarmEnabled?'Sound alarm armed':'Visual alarm · Enable alarm for sound'}</small></div><button type="button" onClick={()=>setLatestAlarm(null)}>Dismiss</button></div>}
    <div className="netflow-summary"><label>Flow highlights <select value={selected} onChange={e=>setSelected(e.target.value)}>{DISPLAY_WINDOWS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>{rows.map(row=>{
      const v=row.values[selected],s=row.stream,unavailable=cellStale(row,selected),large=!unavailable&&(selected!=='1m'||s?.ready)&&Math.abs(v)>=5000000;
      return <div key={row.symbol} className={`netflow-card ${unavailable?'unavailable':v>0?'positive':v<0?'negative':''} ${large?'netflow-triggered':''}`}><b>{row.symbol}</b><div className="netflow-live-price">{livePrice(s?.price)} <small>USDT {healthy&&!s?.stale?'· live':'· last known'}</small></div><strong>{usd(v)}</strong><small>{unavailable?'Last known / unavailable':v>0?'Net buying':v<0?'Net selling':'Net flow'} · {label}</small>{selected==='1m'&&healthy&&!s?.ready&&<small className="netflow-warmup">Collecting full minute: {s?.remaining??60}s · partial</small>}{large&&<span className="netflow-trigger-label">$5M+ NET {v>0?'BUYING':'SELLING'}</span>}<small>Price time: {pktDateTime(s?.lastTrade)}</small></div>;
    })}</div>
    {!healthy&&<p className="netflow-warning" role="status">Live feed {live.status}. Trying WebSocket and automatic REST fallback. {live.error} New $5M events pause until verified data is available.</p>}
    {(error||data?.error)&&<p className="netflow-warning" role="status">Historical windows: {error||data.error}</p>}
    <div className="netflow-events"><div className="netflow-event-heading"><h3>$5M+ live events · 1 minute</h3><button onClick={live.clearEvents} disabled={!live.events.length}>Clear events</button></div><p>Net buying or selling reaches $5M within the latest 60 seconds. Event time is when this app observes the threshold.</p>{live.storageError&&<p role="status">Event history cannot be saved in this browser.</p>}
      {!live.events.length?<p className="netflow-empty">Waiting for a complete live minute and a $5M+ threshold crossing.</p>:<div className="netflow-event-list" aria-live="polite">{live.events.map(event=><div key={event.id} className={`netflow-event ${event.side==='BUY'?'positive':'negative'}`}><b>{event.symbol} · {event.side==='BUY'?'NET BUYING':'NET SELLING'}</b><strong>{usd(event.net)}</strong><span>Price {livePrice(event.price)} USDT</span><time dateTime={new Date(event.time).toISOString()}>{pktDateTime(event.time)}</time></div>)}</div>}
    </div>
    {live.logError&&<p className="netflow-warning" role="status">{live.logError}</p>}
    <NetflowLogPanel revision={live.logRevision} />
    <div className="netflow-scroll"><table><thead><tr><th>Symbol</th><th>Live price · USDT</th>{DISPLAY_WINDOWS.map(([k,l])=><th key={k}>{l}</th>)}<th>Market Cap</th></tr></thead><tbody>{rows.map(row=><tr key={row.symbol}><th><span className={`coin-icon coin-${row.symbol}`}>{({BTC:'₿',ETH:'Ξ',BNB:'◆',USDC:'$',XRP:'✕'})[row.symbol]}</span>{row.symbol}</th><td className={!healthy||row.stream?.stale?'flow-stale':''} title={pktDateTime(row.stream?.lastTrade)}>{livePrice(row.stream?.price)}</td>{DISPLAY_WINDOWS.map(([k,l])=>{const v=row.values[k],old=cellStale(row,k),large=Number.isFinite(v)&&Math.abs(v)>=5000000&&(k!=='1m'||row.stream?.ready);return <td key={k} className={`${old?'flow-stale':v>0?'flow-positive':v<0?'flow-negative':''} ${large&&!old?'flow-large':''}`} title={`${row.symbol} · ${l}: ${usd(v)} net taker flow`}><span>{usd(v)}</span>{k==='1m'&&!row.stream?.ready?<small>PARTIAL</small>:large?<small>$5M+</small>:null}</td>;})}<td>{usd(row.marketCap,false)}</td></tr>)}</tbody></table></div>
    <div className="netflow-footer"><span>Green: net buying · Red: net selling · Highlight: $5M+ · —: unavailable</span><span>{data?.source || 'Historical windows'}: {stale?'stale / loading':'30s refresh'} · {data?.fetchedAt?pktDateTime(data.fetchedAt):'Waiting'}</span></div>
    <p className="netflow-note">Live price and 1-minute flow use WebSocket trades, with a verified rolling-60-second REST fallback every 3 seconds if streaming is unavailable. REST loads the recent minute immediately; a fresh WebSocket needs 60 seconds of coverage. Events stay in this browser (latest 100); one event per observed crossing, with a 60-second cooldown per coin and direction. REST mode can detect crossings only at its refresh times. Tracking requires this page to stay open and active. Values are USDT ≈ USD, and represent taker buying minus selling, not wallet deposits. {data?.notice}</p>
  </section>;
}
