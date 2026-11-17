export const NEWS_CATEGORIES=['Tech / Nvidia','Fed / Macro','ETF / Institutions','Regulation','Exchange / Security','Stablecoins','Geopolitics','Coin updates','General markets'];
const COIN_PATTERNS=[['BTC',/\b(bitcoin|btc)\b/i],['ETH',/\b(ethereum|ether|eth)\b/i],['BNB',/\b(bnb|binance coin)\b/i],['XRP',/\b(xrp|ripple)\b/i],['USDC',/\b(usdc|circle)\b/i]];
export function newsImpact(title){
 const t=String(title).toLowerCase();
 const coins=COIN_PATTERNS.filter(([,re])=>re.test(t)).map(([coin])=>coin);
 let category=/\b(nvidia|nvda|nasdaq|semiconductor|chipmaker|tech stocks|ai stocks)\b/.test(t)?'Tech / Nvidia':/\b(fed|fomc|powell|inflation|cpi|pce|payrolls|unemployment|interest rate|treasury yields|dollar index)\b/.test(t)?'Fed / Macro':/\b(etf|blackrock|fidelity|institutional)\b/.test(t)?'ETF / Institutions':/\b(sec|regulator|regulation|lawsuit|court|crypto ban|legislation)\b/.test(t)?'Regulation':/\b(hack|hacked|exploit|withdrawals|bankrupt|outage|exchange)\b/.test(t)?'Exchange / Security':/\b(stablecoin|usdt|usdc|depeg|tether|circle)\b/.test(t)?'Stablecoins':/\b(war|ceasefire|tariff|shutdown|geopolitical|sanction|missile)\b/.test(t)?'Geopolitics':coins.length?'Coin updates':'General markets';
 const defaults={category,coins:coins.length?coins:['Broad crypto'],direction:'Unclear',importance:'Watch',reason:'Headline se clear direction establish nahin hoti. Original report aur price/volume reaction check karein.',basis:'Headline rules · not a price forecast',direct:coins.length>0};
 const uncertaintyText=t.replace(/(?:higher|lower|hotter|cooler|better|worse|more|less) than expected|(?:above|below) expectations/g,'reported comparison');
 if(/\b(could|might|may|rumou?r|unconfirmed|speculat\w*|forecast\w*|prediction\w*|preview|expected|upcoming|will|what if)\b|\?/.test(uncertaintyText))return {...defaults,reason:'Yeh possibility, opinion ya upcoming event hai; confirmed outcome nahin. Actual announcement ka wait karein.'};
 if(/\betfs?\b.{0,60}\b(inflows? (?:fall|drop|decline|slow)|outflows? (?:fall|drop|decline|slow))\b/.test(t))return {...defaults,direction:'Mixed / review',reason:'Flows ki amount/direction change ho rahi hai. Inflows kam hona net outflow ke barabar nahin; actual values check karein.'};
 let up=[],down=[];
 const add=(direction,match,reason)=>{if(match)(direction==='up'?up:down).push(reason);};
 add('down',/\b(equity markets|stock markets|us stocks|wall street|s&p 500)\b.{0,45}\b(drop\w*|fall\w*|slump\w*|plung\w*|sell-off|selloff)\b/.test(t),'Equity weakness risk-off context ho sakti hai; crypto par indirect pressure possible hai, causal proof nahin.');
 add('up',/\b(equity markets|stock markets|us stocks|wall street|s&p 500)\b.{0,45}\b(rall\w*|surge\w*|gain\w*)\b/.test(t),'Equity strength risk appetite ko support kar sakti hai; crypto ko apne price/netflow se confirm karein.');
 add('down',/\b(nvidia|nvda|nasdaq|tech stocks|ai stocks)\b.{0,65}\b(fall\w*|drop\w*|plung\w*|slid\w*|slump\w*|tumbles?|sell-off|selloff|misses?|disappoint\w*)\b/.test(t),'Tech shares ki weakness risk appetite ko pressure de sakti hai; crypto par yeh indirect link hai.');
 add('up',/\b(nvidia|nvda|nasdaq|tech stocks|ai stocks)\b.{0,65}\b(rall\w*|rise\w*|rises|rose|surge\w*|jump\w*|gains?|beats?)\b/.test(t),'Tech strength risk appetite ko support kar sakti hai; crypto ka apna reaction confirm karein.');
 add('up',/\b(fed|fomc)\b.{0,45}\b(cuts?|cutting|eases?|easing)\b.{0,20}\b(rates?|monetary policy)\b|\b(fed|fomc)\b.{0,30}\brate cuts?\b/.test(t),'Policy easing financial conditions ko support kar sakti hai; expectations aur Fed guidance phir bhi matter karti hain.');
 add('down',/\b(fed|fomc)\b.{0,45}\b(hikes?|raises?|tighten\w*)\b.{0,20}\b(rates?|monetary policy)\b|\b(fed|fomc)\b.{0,30}\brate hikes?\b/.test(t),'Policy tightening risk assets par pressure daal sakti hai; actual decision versus forecast check karein.');
 add('up',/\b(inflation|cpi|pce)\b.{0,45}\b(cools?|eases?|slows?|below expectations|lower than expected)\b/.test(t),'Inflation easing ki headline rate expectations ko support kar sakti hai; actual figures aur consensus compare karein.');
 add('down',/\b(inflation|cpi|pce)\b.{0,45}\b(accelerat\w*|heats?|above expectations|hotter than expected)\b/.test(t),'Hot inflation policy easing ki expectations ko kam kar sakti hai; crypto par possible pressure.');
 add('up',/\betfs?\b.{0,70}\b(inflows?|approv\w*|green light)\b|\bapprov\w*\b.{0,30}\betfs?\b/.test(t),'ETF demand ya approval access ko support kar sakta hai; flow ka size aur price reaction dekhein.');
 add('down',/\betfs?\b.{0,70}\b(outflows?|reject\w*|denied)\b/.test(t),'ETF outflow ya rejection demand/sentiment par pressure daal sakta hai.');
 add('down',/\b(hacked|hack|exploit|bankruptcy|bankrupt|insolvency|depeg\w*|halts? withdrawals|suspends? withdrawals|withdrawals halted|withdrawals suspended)\b/.test(t),'Security, liquidity ya stablecoin stress related assets aur wider crypto sentiment ke liye risk ho sakta hai.');
 add('up',/\b(resumes? withdrawals|withdrawals resume|restores? withdrawals|regains? (its )?peg)\b/.test(t),'Liquidity/access ki restoration related stress ko kam kar sakti hai; recovery verify karein.');
 add('down',/\b(delists?|delisting|bans? crypto|crypto ban|war escalates|missile attack|raises? tariffs|tariffs increased)\b/.test(t),'Access restrictions ya geopolitical escalation risk appetite aur liquidity par pressure daal sakti hai.');
 add('up',/\b(ceasefire agreed|ceasefire deal|tariffs reduced|cuts? tariffs)\b/.test(t),'Geopolitical/trade tension mein kami sentiment ko support kar sakti hai; response guaranteed nahin.');
 add('up',/\b(bitcoin|ethereum|xrp|bnb)\b.{0,35}\b(surges?|rallies|jumps?)\b/.test(t),'Headline recent price strength report karti hai; move pehle hi ho sakta hai, yeh early prediction nahin.');
 add('down',/\b(bitcoin|ethereum|xrp|bnb)\b.{0,35}\b(plunges?|tumbles?|slumps?)\b/.test(t),'Headline recent price weakness report karti hai; move pehle hi ho sakta hai, yeh early prediction nahin.');
 // Negated directional statements need human review rather than a literal keyword match.
 if(/\b(no|not|denies?|denied|false|debunks?)\b/.test(t))return {...defaults,direction:'Mixed / review',reason:'Negation ya disputed claim present hai. Headline ke keywords se direction assign karna reliable nahin.'};
 if(up.length&&down.length)return {...defaults,direction:'Mixed / review',importance:'High attention',reason:'Headline mein opposing signals hain. Original context aur live price reaction zaroori hai.'};
 if(up.length||down.length)return {...defaults,direction:up.length?'Potential bullish':'Potential bearish',importance:'High attention',reason:(up[0]||down[0])};
 if(/\b(earnings|funding deadline|fomc|cpi|payrolls|rate decision)\b/.test(t))return {...defaults,importance:'Event watch',reason:'Yeh scheduled catalyst hai. Result versus market expectation ke baghair direction assign nahin ki gayi.'};
 return defaults;
}
