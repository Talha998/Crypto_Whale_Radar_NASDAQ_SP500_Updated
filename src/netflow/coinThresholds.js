// Owner-selected fixed net-flow alarm: absolute net taker flow in a rolling 60 seconds.
export const COIN_RULES=Object.fromEntries(['BTC','USDC','ETH','BNB','SOL','XRP'].map(symbol=>[symbol,{threshold:5_000_000,group:'fixed'}]));
export const COIN_GROUPS=[{id:'fixed',name:'BTC · USDC · ETH · BNB · SOL · XRP · fixed ±$5M / minute',coins:['BTC','USDC','ETH','BNB','SOL','XRP']}];
const dailyMoverSet=new Set();
export function setDailyMoverSymbols(symbols=[]){dailyMoverSet.clear();symbols.forEach(symbol=>{if(/^[A-Z0-9]{2,15}$/.test(symbol))dailyMoverSet.add(symbol);});}
export const isDailyMover=symbol=>dailyMoverSet.has(symbol);
export const thresholdFor=symbol=>COIN_RULES[symbol]?.threshold??(isDailyMover(symbol)?2_000_000:Infinity);
