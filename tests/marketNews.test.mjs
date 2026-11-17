import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {parseNewsFeed,mergeNews,createNewsService} from '../market-news-server.mjs';
import {newsImpact} from '../src/news/newsImpact.js';
const now=Date.UTC(2026,10,18),feed={id:'test',name:'Example News',url:'https://example.com/rss'};
const xml=(title='Nvidia shares plunge after earnings')=>`<rss><channel><item><title><![CDATA[${title}]]></title><link>https://example.com/a?utm_source=rss&amp;id=1</link><pubDate>Tue, 17 Nov 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'market-news-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'news.json');}
test('RSS parser preserves publisher publication date separately from collection time',()=>{
 const [a]=parseNewsFeed(xml(),feed);assert.equal(a.title,'Nvidia shares plunge after earnings');assert.equal(a.publishedAt,Date.UTC(2026,10,17,18));assert.equal(a.url,'https://example.com/a?utm_source=rss&id=1');assert.equal(a.publisher,'Example News');
});
test('Atom headlines and source metadata parse without turning unavailable dates into now',()=>{
 const [a]=parseNewsFeed('<feed><entry><title>Bitcoin &amp; ETFs</title><link rel="alternate" href="https://example.com/b"/><source>Official publisher</source></entry></feed>',feed);
 assert.equal(a.title,'Bitcoin & ETFs');assert.equal(a.publishedAt,null);assert.equal(a.publisher,'Official publisher');
});
test('unsafe URLs and HTML error pages cannot become news links',()=>{
 assert.equal(parseNewsFeed(xml().replace('https://example.com/a?utm_source=rss&amp;id=1','javascript:alert(1)'),feed).length,0);assert.throws(()=>parseNewsFeed('<html>Access denied</html>',feed));
});
test('same story deduplicates across tracking URLs and preserves first-seen timestamp',()=>{
 const [a]=parseNewsFeed(xml(),feed),first=mergeNews([],[a],now),next=mergeNews(first,[{...a,url:'https://example.com/a?id=1&utm_source=other'}],now+10000);
 assert.equal(next.length,1);assert.equal(next[0].firstSeen,now);assert.equal(next[0].lastSeen,now+10000);assert.equal(next[0].impact.direction,'Potential bearish');
});
test('future-dated stories are withheld and archived stories expire after seven days',()=>{
 const [a]=parseNewsFeed(xml(),feed);
 assert.equal(mergeNews([],[{...a,publishedAt:now+3600000}],now).length,0);assert.equal(mergeNews([],[{...a,publishedAt:now-8*86400000}],now).length,0);
});
test('Nvidia/tech effects are labelled possible and indirect, not an actual crypto prediction',()=>{
 const down=newsImpact('Nvidia shares plunge after earnings');assert.equal(down.direction,'Potential bearish');assert.equal(down.category,'Tech / Nvidia');assert.equal(down.direct,false);assert.deepEqual(down.coins,['Broad crypto']);
 assert.equal(newsImpact('Nvidia shares surge after earnings beat').direction,'Potential bullish');
});
test('rumours, questions, negations and upcoming earnings never become definitive directional signals',()=>{
 for(const title of ['Nvidia could plunge tomorrow','Will Bitcoin surge?','Bitcoin ETF approval expected tomorrow','Nvidia earnings preview'])assert.equal(newsImpact(title).direction,'Unclear');
 assert.equal(newsImpact('Exchange denies hack report').direction,'Mixed / review');
});
test('Fed rate decisions and CPI surprises are distinguished from unrelated cuts',()=>{
 assert.equal(newsImpact('Fed cuts interest rates by 25 basis points').direction,'Potential bullish');assert.equal(newsImpact('Fed raises interest rates').direction,'Potential bearish');assert.equal(newsImpact('Fed cuts staff expenses').direction,'Unclear');
 assert.equal(newsImpact('US CPI inflation comes in hotter than expected').direction,'Potential bearish');
 assert.equal(newsImpact('US inflation accelerates in October').direction,'Potential bearish');
});
test('security events, ETF flows and contradictory headlines receive bounded context',()=>{
 assert.equal(newsImpact('Exchange hacked and withdrawals suspended').direction,'Potential bearish');assert.equal(newsImpact('Bitcoin ETFs record inflows').direction,'Potential bullish');assert.equal(newsImpact('Bitcoin ETFs record outflows').direction,'Potential bearish');assert.equal(newsImpact('Bitcoin ETF inflows decline sharply').direction,'Mixed / review');
 assert.equal(newsImpact('Bitcoin ETFs see inflows and outflows').direction,'Mixed / review');assert.deepEqual(newsImpact('XRP ETF receives approval').coins,['XRP']);
});
test('working feeds remain useful when another publisher is blocked; repeated callers share cache',async t=>{
 const file=await fixture(t);let calls=0;
 const feeds=[feed,{...feed,id:'blocked',url:'https://blocked.example/rss'}];
 const service=createNewsService({file,feeds,clock:()=>now,fetcher:async url=>{calls++;return url.includes('blocked')?{ok:false,status:403}:{ok:true,text:async()=>xml()};}});
 const [a,b]=await Promise.all([service(),service()]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.stale,false);assert.equal(a.articles.length,1);assert.equal(a.sources[1].status,'unavailable');await service();assert.equal(calls,2);
});
test('archive survives restart and all feeds failing is explicitly stale',async t=>{
 const file=await fixture(t);const first=createNewsService({file,feeds:[feed],clock:()=>now,fetcher:async()=>({ok:true,text:async()=>xml()})});await first();
 const restarted=createNewsService({file,feeds:[feed],clock:()=>now+200000,fetcher:async()=>{throw Error('offline');}});
 const next=await restarted();assert.equal(next.stale,true);assert.equal(next.articles[0].firstSeen,now);assert.equal(next.sources[0].status,'unavailable');
});
test('corrupt archive is retained rather than silently overwritten',async t=>{
 const file=await fixture(t);await writeFile(file,'broken-json');
 const service=createNewsService({file,feeds:[feed],clock:()=>now,fetcher:async()=>({ok:true,text:async()=>xml()})});const data=await service();assert.equal(data.articles.length,1);assert.match(data.storageError,/retained/);assert.equal(await readFile(file,'utf8'),'broken-json');
});
