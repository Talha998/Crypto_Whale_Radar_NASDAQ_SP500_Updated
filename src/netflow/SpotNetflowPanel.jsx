import {thresholdFor,COIN_GROUPS,setDailyMoverSymbols} from './coinThresholds.js';
import useLiquidityDepth from './useLiquidityDepth.js';
import NetflowLogPanel from './NetflowLogPanel.jsx';
import React, {useEffect,useRef,useState} from 'react';
import {COINS,WINDOWS,usd} from './netflow.js';
import useLiveMinuteFlow from './useLiveMinuteFlow.js';
import {livePrice,pktDateTime} from './liveMinuteFlow.js';
import {TRADFI_MARKETS} from './tradFiMarkets.js';
import './netflow.css';
const DISPLAY_WINDOWS=[['1m','1 minute · live',1],...WINDOWS];
const TABLE_COLUMNS=DISPLAY_WINDOWS.length+8;
const CORE_BADGES={BTC:'₿',ETH:'Ξ',BNB:'◆',USDC:'$',XRP:'✕',SOL:'◎'};

function NetflowRow({symbol,name=symbol,badge,subtitle,stream,history,book,depthBand,depthError,tick,liveStale,threshold,thresholdLabel}) {
  const band=book?.bands?.find(item=>item.band===depthBand);
  const bookStale=!!depthError||book?.stale||!book?.fetchedAt||tick-book.fetchedAt>25000;
  const liveValue=stream?.lastTrade?stream.net:null;
  const thresholdHit=!liveStale&&stream?.ready&&Number.isFinite(threshold)&&Math.abs(liveValue)>=threshold;
  const flowClass=(value,old)=>old?'flow-stale':value>0?'flow-positive':value<0?'flow-negative':'';
  const depthCell=(side)=>{
    const complete=band?.[side+'Complete'];
    const amount=band?.[side+'USDT'];
    return <td className={bookStale?'flow-stale':''}>
      {band?`${complete?'':'≥ '}${usd(amount,false)}`:'—'}
      <small>{bookStale?'STALE / UNAVAILABLE':complete?'FULL BAND':'PARTIAL BOOK'}</small>
    </td>;
  };
  return <tr>
    <th scope="row">
      <span className={`coin-icon coin-${symbol}`}>{badge}</span>{name}
      {subtitle&&<small className="netflow-symbol-detail">{subtitle}</small>}
    </th>
    <td className={liveStale?'flow-stale':''}>{livePrice(stream?.price)}</td>
    <td className="netflow-threshold">
      {Number.isFinite(threshold)?`±${usd(threshold,false)}`:'—'}
      <small>{thresholdLabel}</small>
    </td>
    <td className={`${flowClass(liveValue,liveStale)} ${thresholdHit?'flow-large':''}`}>
      {usd(liveValue)}
      <small>{thresholdHit?'THRESHOLD HIT':!stream?.ready?'WAITING / PARTIAL':'ROLLING 60s'}</small>
    </td>
    {depthCell('bid')}{depthCell('ask')}
    <td className={bookStale?'flow-stale':''}>{Number.isFinite(book?.spreadPct)?book.spreadPct.toFixed(4)+'%':'—'}</td>
    <td className={`netflow-depth-time ${bookStale?'flow-stale':''}`}>
      {book?.fetchedAt?pktDateTime(book.fetchedAt):'Waiting for depth'}
    </td>
    {WINDOWS.map(([key,label])=>{
      const value=history?.values?.[key];
      const old=!history||history.stale||!!history.error;
      return <td key={key} className={flowClass(value,old)} title={`${symbol} · ${label}: ${usd(value)} net taker flow`}>{usd(value)}</td>;
    })}
    <td>{usd(history?.marketCap,false)}</td>
  </tr>;
}

export default function SpotNetflowPanel({alarmEnabled=false,alarmMessage='',onEnableAlarm,onDisableAlarm,onTestAlarm,onNetflowAlarm}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(Date.now());
  const [selected,setSelected]=useState('1m');
  const [depthBand,setDepthBand]=useState(0.005),depth=useLiquidityDepth();
  const [latestAlarm,setLatestAlarm]=useState(null);
  const [dailyMovers,setDailyMovers]=useState([]),[moversUpdated,setMoversUpdated]=useState(null),[moversError,setMoversError]=useState('');
  const [futuresLive,setFuturesLive]=useState({rows:[],error:''});
  const live=useLiveMinuteFlow(event=>{setLatestAlarm(event);onNetflowAlarm?.(event);},dailyMovers.map(x=>x.symbol)),healthy=live.status==='live';
  const active=useRef(false),controller=useRef();
  const refresh=async()=>{
    if(active.current)return;active.current=true;setBusy(true);
    const ctrl=new AbortController();controller.current=ctrl;const timeout=setTimeout(()=>ctrl.abort(),90000);
    try {const res=await fetch('/api/spot-netflow',{signal:ctrl.signal});if(!res.ok)throw Error();const body=await res.json();if(!Array.isArray(body.rows))throw Error();if(!ctrl.signal.aborted){setData(body);setError('');}}
    catch {if(!ctrl.signal.aborted)setError('Historical windows unavailable. Retrying automatically.');}
    finally {clearTimeout(timeout);active.current=false;setBusy(false);}
  };
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000),age=setInterval(()=>setTick(Date.now()),1000);return()=>{clearInterval(timer);clearInterval(age);controller.current?.abort();};},[]);
  useEffect(()=>{let stopped=false,busy=false,controller;
    const load=async()=>{if(busy)return;busy=true;controller=new AbortController();try{const res=await fetch('/api/spot-movers',{signal:controller.signal});if(!res.ok)throw Error();const body=await res.json();if(!Array.isArray(body.movers)||body.movers.length!==10)throw Error();if(!stopped){setDailyMoverSymbols(body.movers.map(x=>x.symbol));setDailyMovers(body.movers);setMoversUpdated(body.updatedAt);setMoversError(body.error||'');}}catch{if(!stopped)setMoversError('Daily gainers/losers list unavailable. Retrying automatically.');}finally{busy=false;}};
    load();const timer=setInterval(load,5*60*1000);return()=>{stopped=true;clearInterval(timer);controller?.abort();};
  },[]);
  useEffect(()=>{
    let stopped=false,controller;
    async function load(){
      if(controller)return;
      controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await fetch('/api/futures-live-minute',{signal:controller.signal});
        if(!response.ok)throw Error('Futures minute feed unavailable');
        const body=await response.json();
        if(!Array.isArray(body.rows))throw Error('Invalid Futures minute feed');
        if(!stopped)setFuturesLive(body);
      }catch{
        if(!stopped)setFuturesLive(previous=>({...previous,error:'Futures minute feed unavailable; retrying.'}));
      }finally{
        clearTimeout(timeout);
        controller=null;
      }
    }
    load();
    const timer=setInterval(load,10000);
    return()=>{stopped=true;clearInterval(timer);controller?.abort();};
  },[]);
  const stale=!!error||data?.stale||!data?.fetchedAt||tick-data.fetchedAt>90000;
  const rows=COINS.map(symbol=>{
    const historical=data?.rows.find(r=>r.symbol===symbol)||{symbol,values:{}};
    const stream=live.rows.find(r=>r.symbol===symbol);
    return {...historical,stream,values:{...historical.values,'1m':stream?.lastTrade?stream.net:null}};
  });
  const label=DISPLAY_WINDOWS.find(w=>w[0]===selected)?.[1];
  const cellStale=(row,key)=>key==='1m'?!healthy||!!row.stream?.stale:stale||!!row.error;
  function renderSpotRow(symbol,badge,subtitle,thresholdLabel){
    const stream=live.rows.find(row=>row.symbol===symbol);
    return <NetflowRow key={symbol} symbol={symbol} badge={badge} subtitle={subtitle} stream={stream}
      history={data?.rows.find(row=>row.symbol===symbol)} book={depth.rows.find(row=>row.symbol===symbol)}
      depthBand={depthBand} depthError={depth.error} tick={tick}
      liveStale={!healthy||!stream||!!stream.stale||!stream.lastTrade||tick-stream.lastTrade>15000}
      threshold={thresholdFor(symbol)} thresholdLabel={thresholdLabel} />;
  }
  return <section className="netflow-panel" aria-label="Cryptocurrency Spot Netflow Statistics">
    <div className="netflow-heading"><div><span className="netflow-eyebrow">SPOT MONEY FLOW · 6 CORE + 10 DAILY MOVERS</span><h2>Cryptocurrency Spot Netflow Statistics</h2><p>Binance Spot · live USDT prices &amp; rolling 60-second flow <span className={`netflow-status ${healthy?'':'waiting'}`}>{healthy?`LIVE · ${live.transport}`:live.status.toUpperCase()}</span></p><p className="netflow-clock">{pktDateTime(tick)}</p></div><button onClick={refresh} disabled={busy}>{busy?'Updating history…':'Refresh history'}</button></div>
    <div className="netflow-alarm-controls"><div><b>1-minute sound alarms · BUY &amp; SELL</b><small>BTC, USDC, ETH, BNB, SOL, XRP: ±$5.00M. Daily 5 gainers + 5 losers: ±$2.00M net flow in a rolling 60 seconds.</small></div><button type="button" className={alarmEnabled?'is-armed':''} onClick={alarmEnabled?onDisableAlarm:onEnableAlarm}>{alarmEnabled?'🔔 Alarm armed · Disable':'🔕 Enable alarm'}</button><button type="button" onClick={onTestAlarm}>Test sound</button><small role="status">{alarmMessage}</small></div>
    {latestAlarm&&<div role="alert" className={`netflow-alarm-banner ${latestAlarm.side==='SELL'?'negative':'positive'}`}><div><b>🔔 {latestAlarm.symbol} · 1-MINUTE {latestAlarm.side==='BUY'?'NET BUYING':'NET SELLING'} ALARM</b><strong>{usd(latestAlarm.net)}</strong><span>Price {livePrice(latestAlarm.price)} USDT · {pktDateTime(latestAlarm.time)}</span><small>{alarmEnabled?'Sound alarm armed':'Visual alarm · Enable alarm for sound'}</small></div><button type="button" onClick={()=>setLatestAlarm(null)}>Dismiss</button></div>}
    <div className="netflow-summary"><label>Flow highlights <select value={selected} onChange={e=>setSelected(e.target.value)}>{DISPLAY_WINDOWS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>{rows.map(row=>{
      const v=row.values[selected],s=row.stream,unavailable=cellStale(row,selected),large=selected==='1m'&&!unavailable&&s?.ready&&Math.abs(v)>=thresholdFor(row.symbol);
      return <div key={row.symbol} className={`netflow-card ${unavailable?'unavailable':v>0?'positive':v<0?'negative':''} ${large?'netflow-triggered':''}`}><b>{row.symbol}</b><small>1m alarm: ±{usd(thresholdFor(row.symbol),false)}</small><div className="netflow-live-price">{livePrice(s?.price)} <small>USDT {healthy&&!s?.stale?'· live':'· last known'}</small></div><strong>{usd(v)}</strong><small>{unavailable?'Last known / unavailable':v>0?'Net buying':v<0?'Net selling':'Net flow'} · {label}</small>{selected==='1m'&&healthy&&!s?.ready&&<small className="netflow-warmup">Collecting full minute: {s?.remaining??60}s · partial</small>}{large&&<span className="netflow-trigger-label">THRESHOLD HIT · NET {v>0?'BUYING':'SELLING'}</span>}<small>Price time: {pktDateTime(s?.lastTrade)}</small></div>;
    })}</div>
    {!healthy&&<p className="netflow-warning" role="status">Live feed {live.status}. Trying WebSocket and automatic REST fallback. {live.error} New threshold events pause until verified data is available.</p>}
    {(error||data?.error)&&<p className="netflow-warning" role="status">Historical windows: {error||data.error}</p>}
    {moversError&&<p className="netflow-warning" role="status">Daily movers: {moversError}</p>}
    <div className="netflow-events"><div className="netflow-event-heading"><h3>Per-coin threshold events · 1 minute</h3><button onClick={live.clearEvents} disabled={!live.events.length}>Clear events</button></div><p>Net buying or selling reaches that coin’s threshold within the latest 60 seconds. Event time is when this app observes the threshold.</p>{live.storageError&&<p role="status">Event history cannot be saved in this browser.</p>}
      {!live.events.length?<p className="netflow-empty">Waiting for a complete live minute and a coin-specific threshold crossing.</p>:<div className="netflow-event-list" aria-live="polite">{live.events.map(event=><div key={event.id} className={`netflow-event ${event.side==='BUY'?'positive':'negative'}`}><b>{event.symbol} · {event.side==='BUY'?'NET BUYING':'NET SELLING'}</b><strong>{usd(event.net)}</strong><span>Price {livePrice(event.price)} USDT · Threshold ±{usd(event.thresholdUSDT??5000000,false)}</span><time dateTime={new Date(event.time).toISOString()}>{pktDateTime(event.time)}</time></div>)}</div>}
    </div>
    {live.logError&&<p className="netflow-warning" role="status">{live.logError}</p>}
    <NetflowLogPanel revision={live.logRevision} />
    <div className="netflow-depth-controls"><label>Order-book band <select value={depthBand} onChange={e=>setDepthBand(Number(e.target.value))}><option value={0.001}>±0.1% from midpoint</option><option value={0.005}>±0.5% from midpoint</option></select></label><span>Binance Spot / Futures USDT depth · 10s snapshots · ≥ means partial coverage</span></div>
    {futuresLive.error&&<p role="status" className="netflow-warning">{futuresLive.error}</p>}
    {depth.error&&<p role="status" className="netflow-warning">{depth.error}</p>}
    <div className="netflow-scroll"><table>
      <thead><tr>
        <th>Symbol</th><th>Latest price · USDT</th><th>1m alarm threshold</th><th>1 minute · live</th>
        <th>Buy depth · bids<br/>within −{depthBand*100}%</th>
        <th>Sell depth · asks<br/>within +{depthBand*100}%</th>
        <th>Spread</th><th>Depth received · PKT</th>
        {WINDOWS.map(([key,label])=><th key={key}>{label}</th>)}<th>Market Cap</th>
      </tr></thead>
      {COIN_GROUPS.map(group=><tbody key={group.id}>
        <tr className="netflow-group-row"><th colSpan={TABLE_COLUMNS}>{group.name}</th></tr>
        {group.coins.map(symbol=>renderSpotRow(symbol,CORE_BADGES[symbol],null,'Fixed'))}
      </tbody>)}
      <tbody>
        <tr className="netflow-group-row"><th colSpan={TABLE_COLUMNS}>Gold · Silver · S&amp;P 500 · Binance Futures USDT perpetuals</th></tr>
        {TRADFI_MARKETS.map(({symbol,name,badge})=>{
          const stream=futuresLive.rows.find(row=>row.symbol===symbol);
          return <NetflowRow key={symbol} symbol={symbol} name={name} badge={badge} subtitle={symbol+'USDT · perpetual'}
            stream={stream} history={data?.futuresRows?.find(row=>row.symbol===symbol)}
            book={depth.futuresRows?.find(row=>row.symbol===symbol)} depthBand={depthBand} depthError={depth.error} tick={tick}
            liveStale={!!futuresLive.error||!stream?.asOf||stream.stale||tick-stream.asOf>25000}
            thresholdLabel="No alarm configured" />;
        })}
      </tbody>
      <tbody>
        <tr className="netflow-group-row"><th colSpan={TABLE_COLUMNS}>Daily top 5 gainers + 5 losers · liquid Binance USDT pairs · ±$2M / minute · {moversUpdated?`updated ${pktDateTime(moversUpdated)}`:moversError?'List unavailable':'Loading daily movers…'}</th></tr>
        {dailyMovers.map(mover=>renderSpotRow(mover.symbol,mover.side==='GAINER'?'↗':'↘',
          `${mover.side} · ${mover.changePct>0?'+':''}${mover.changePct.toFixed(2)}% / 24h`,'Daily mover'))}
      </tbody>
    </table></div>
    <p className="netflow-note">Core spot alarms use ±$5M and daily movers use ±$2M. Gold, Silver and S&amp;P 500 use Binance perpetual prices and flow. Order book depth shows pending orders within the selected band. Netflow shows executed trades. ≥ indicates partial order book coverage.</p>
    <div className="netflow-footer"><span>Green: net buying · Red: net selling · 1m highlight: coin threshold · —: unavailable</span><span>{data?.source || 'Historical windows'}: {stale?'stale / loading':'30s refresh'} · {data?.fetchedAt?pktDateTime(data.fetchedAt):'Waiting'}</span></div>
    <p className="netflow-note">Spot price and 1-minute flow use WebSocket trades, with a verified rolling-60-second REST fallback every 3 seconds if streaming is unavailable. REST loads the recent minute immediately; a fresh WebSocket needs 60 seconds of coverage. Events stay in this browser (latest 100); one event per observed crossing, with a 60-second cooldown per coin and direction. REST mode can detect crossings only at its refresh times. Tracking requires this page to stay open and active. Futures 1-minute flow refreshes through REST every 10 seconds. Values are USDT ≈ USD, and represent taker buying minus selling, not wallet deposits. {data?.notice}</p>
  </section>;
}
