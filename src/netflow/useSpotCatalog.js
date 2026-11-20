import {useEffect,useState} from 'react';

const PAGE_SIZE=6;
const EMPTY_ROWS=[];

function searchScore(symbol,query){
  const base=symbol.toUpperCase();
  const pair=base+'USDT';
  if(base===query||pair===query)return 0;
  if(base.startsWith(query))return 1;
  if(base.includes(query))return 2;
  return base!==query&&query.endsWith('USDT')&&pair.includes(query)?3:Infinity;
}

export default function useSpotCatalog(coreSymbols){
  const [catalog,setCatalog]=useState({symbols:[],loading:true,stale:false});
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [details,setDetails]=useState(null);

  useEffect(()=>{
    let stopped=false,controller;
    async function load(){
      if(controller)return;
      controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await fetch('/api/spot-catalog',{signal:controller.signal});
        if(!response.ok)throw Error('Catalog unavailable');
        const body=await response.json();
        if(!Array.isArray(body.symbols))throw Error('Invalid catalog');
        if(!stopped)setCatalog({...body,loading:false});
      }catch{
        if(!stopped)setCatalog(previous=>({...previous,loading:false,stale:true}));
      }finally{
        clearTimeout(timeout);
        controller=null;
      }
    }
    load();
    const timer=setInterval(load,60000);
    return()=>{stopped=true;clearInterval(timer);controller?.abort();};
  },[]);

  const symbols=[...new Set([...coreSymbols,...catalog.symbols])];
  const term=query.trim().toUpperCase().replace(/[\s/_-]+/g,'');
  const matches=term?symbols.map(symbol=>({symbol,rank:searchScore(symbol,term)}))
    .filter(item=>Number.isFinite(item.rank)).sort((a,b)=>a.rank-b.rank).map(item=>item.symbol):symbols;
  const lastPage=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
  const currentPage=Math.min(page,lastPage);
  const visible=matches.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  const params=new URLSearchParams();
  for(const symbol of visible)if(!coreSymbols.includes(symbol))params.append('symbol',symbol);
  const requestKey=params.toString();

  useEffect(()=>{
    if(!requestKey)return;
    let stopped=false,controller;
    async function load(){
      if(controller)return;
      controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),55000);
      try{
        const response=await fetch('/api/spot-catalog-data?'+requestKey,{signal:controller.signal});
        if(!response.ok)throw Error('Market data unavailable');
        const body=await response.json();
        if(!Array.isArray(body.rows))throw Error('Invalid market data');
        if(!stopped)setDetails({key:requestKey,rows:body.rows,error:false});
      }catch{
        if(!stopped)setDetails(previous=>({
          key:requestKey,rows:previous?.key===requestKey?previous.rows:EMPTY_ROWS,error:true,
        }));
      }finally{
        clearTimeout(timeout);
        controller=null;
      }
    }
    const start=setTimeout(load,250);
    const timer=setInterval(load,10000);
    return()=>{stopped=true;clearTimeout(start);clearInterval(timer);controller?.abort();};
  },[requestKey]);

  const current=details?.key===requestKey?details:null;
  return {
    query,changeQuery(value){setQuery(value);setPage(1);},
    page:currentPage,lastPage,setPage,visible,matchCount:matches.length,
    catalogLoading:catalog.loading,catalogStale:catalog.stale,
    rows:current?.rows??EMPTY_ROWS,detailsLoading:!!requestKey&&!current,detailsError:!!current?.error,
  };
}
