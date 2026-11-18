export const DEPTH_BANDS=[0.001,0.005];
export function summarizeDepth(book,limit=1000){
 function levels(raw,side){if(!Array.isArray(raw)||!raw.length)throw Error('Missing book side');return raw.map((v,i)=>{const price=Number(v[0]),qty=Number(v[1]);if(!Number.isFinite(price)||!Number.isFinite(qty)||price<=0||qty<=0)throw Error('Invalid book level');if(i&&!(side==='bid'?price<Number(raw[i-1][0]):price>Number(raw[i-1][0])))throw Error('Unsorted book');return {price,qty};});}
 const bids=levels(book.bids,'bid'),asks=levels(book.asks,'ask');
 if(bids[0].price>=asks[0].price)throw Error('Crossed order book');
 const mid=(bids[0].price+asks[0].price)/2,spreadPct=(asks[0].price-bids[0].price)/mid*100;
 const bands=DEPTH_BANDS.map(band=>{
  const bidFloor=mid*(1-band),askCeiling=mid*(1+band);
  const bidComplete=bids.length<limit||bids.at(-1).price<=bidFloor,askComplete=asks.length<limit||asks.at(-1).price>=askCeiling;
  const bidUSDT=bids.filter(x=>x.price>=bidFloor).reduce((s,x)=>s+x.price*x.qty,0),askUSDT=asks.filter(x=>x.price<=askCeiling).reduce((s,x)=>s+x.price*x.qty,0);
  return {band,bidUSDT,askUSDT,bidComplete,askComplete};
 });
 return {mid,spreadPct,bestBid:bids[0].price,bestAsk:asks[0].price,bidLevels:bids.length,askLevels:asks.length,lastUpdateId:book.lastUpdateId??null,bands};
}
