export const SPOT_MARKET = {
  hosts: ['https://data-api.binance.vision','https://api.binance.com'],
  prefix: '/api/v3',
};

export const FUTURES_MARKET = {
  hosts: ['https://fapi.binance.com'],
  prefix: '/fapi/v1',
};

const cooldownByMarket = new WeakMap();

export async function fetchBinanceMarket(market, path, {fetcher=fetch, timeout=12000, clock=Date.now}={}) {
  if(clock() < (cooldownByMarket.get(market) ?? 0)) {
    throw Error('Binance rate limit cooldown');
  }
  let failure;
  for(const host of market.hosts) {
    try {
      const response=await fetcher(host+market.prefix+path,{signal:AbortSignal.timeout(timeout)});
      if(response.status===429 || response.status===418) {
        const retry=Number(response.headers?.get?.('retry-after'));
        cooldownByMarket.set(market,clock()+Math.max(60000,(retry||60)*1000));
        throw Error('Binance rate limit cooldown');
      }
      if(!response.ok)throw Error('Binance HTTP '+response.status);
      return await response.json();
    } catch(error) {
      failure=error;
      if(clock() < (cooldownByMarket.get(market) ?? 0))break;
    }
  }
  throw failure;
}
