import {useEffect,useState} from 'react';
export default function useLiquidityDepth(){const [state,setState]=useState({rows:[],futuresRows:[],error:''});
 useEffect(()=>{let stopped=false,busy=false,controller;
  async function load(){if(busy)return;busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
   try{const r=await fetch('/api/spot-depth',{signal:controller.signal});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.rows))throw Error();if(!stopped)setState({...data,error:'',receivedAt:Date.now()});}
   catch{if(!stopped)setState(old=>({...old,error:'Depth unavailable. Netflow alarms still use verified trade data.'}));}
   finally{clearTimeout(timeout);busy=false;}
  }load();const timer=setInterval(load,10000);return()=>{stopped=true;clearInterval(timer);controller?.abort();};
 },[]);return state;}
