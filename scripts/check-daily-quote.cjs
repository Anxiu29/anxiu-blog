const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.join(__dirname,'..');const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,'src',file),'utf8'),{compilerOptions:{target:99,module:1}}).outputText;
const data={exports:{}};vm.runInNewContext(compile('data/daily-quotes.ts'),data);const quotes=data.exports.dailyQuotes;
let clock=Date.parse('2026-11-27T07:00:00Z');class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const nodes={};const page={isConnected:true,dataset:{},querySelector:s=>nodes[s]??=({textContent:''})};let mounted=page,id=0;
const timers=new Map(),events={},windowEvents={};
const doc={hidden:false,querySelector:()=>mounted,addEventListener(k,fn){(events[k]||=[]).push(fn);}};
const win={setTimeout(fn,delay){timers.set(++id,{fn,due:clock+delay});return id;},clearTimeout(key){timers.delete(key);},addEventListener(k,fn){(windowEvents[k]||=[]).push(fn);}};
const ctx={exports:{},require:()=>data.exports,Date:Clock,document:doc,window:win};vm.runInNewContext(compile('scripts/daily-quote.ts'),ctx);const api=ctx.exports;
function advance(ms){const end=clock+ms;let count=0;while(true){const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];if(!next||next[1].due>end)break;if(++count>2000)throw Error('timer loop');timers.delete(next[0]);clock=next[1].due;next[1].fn();}clock=end;}
const visible=()=>nodes['[data-quote-text]'].textContent,full=()=>nodes['[data-quote-accessible]'].textContent;
assert.equal(api.quoteDay(new Date('2026-11-27T15:59:59Z')),'2026-11-27');assert.equal(api.quoteDay(new Date('2026-11-27T16:00:00Z')),'2026-11-28');
assert.equal(new Set(quotes.map(q=>q.id)).size,quotes.length);assert.equal(new Set(quotes.map(q=>q.text)).size,quotes.length);
api.initializeDailyQuote();const first=quotes[api.dailyIndex('2026-11-27')].text;
assert.equal(full(),first);assert.equal(visible(),Array.from(first)[0]);assert.equal(page.dataset.state,'typing');assert.equal(timers.size,1);
api.initializeDailyQuote();assert.equal(timers.size,1,'repeat initialization cannot double the animation');assert.equal(events.visibilitychange.length,1);
advance((Array.from(first).length-1)*api.QUOTE_TYPE_DELAY);assert.equal(visible(),first);assert.equal(page.dataset.state,'holding');
advance(6999);assert.equal(visible(),first,'hold starts only after the final character and lasts seven full seconds');
advance(1);const second=quotes[api.dailyIndex('2026-11-27',1)].text;assert.equal(full(),second);assert.equal(visible(),Array.from(second)[0]);assert.equal(page.dataset.state,'typing');
doc.hidden=true;events.visibilitychange[0]();assert.equal(timers.size,0);const paused=visible();advance(10000);assert.equal(visible(),paused,'background page does not keep rotating');
doc.hidden=false;events.visibilitychange[0]();advance(api.QUOTE_TYPE_DELAY);assert.equal(visible(),Array.from(second).slice(0,2).join(''));
mounted=null;api.initializeDailyQuote();assert.equal(timers.size,0,'leaving home cancels the animation');mounted=page;api.initializeDailyQuote();assert.equal(timers.size,1,'returning resumes one controller');
windowEvents.pagehide[0]();assert.equal(timers.size,0);windowEvents.pageshow[0]();assert.equal(timers.size,1);
doc.hidden=true;events.visibilitychange[0]();clock=Date.parse('2026-11-27T16:00:01Z');doc.hidden=false;events.visibilitychange[0]();assert.equal(page.dataset.day,'2026-11-28');assert.equal(full(),quotes[api.dailyIndex('2026-11-28')].text);assert.equal(visible().length,1);
advance((Array.from(full()).length-1)*api.QUOTE_TYPE_DELAY);const held=visible();advance(900);doc.hidden=true;events.visibilitychange[0]();advance(5000);doc.hidden=false;events.visibilitychange[0]();advance(6099);assert.equal(visible(),held,'pause retains the remaining hold time');advance(1);assert.equal(page.dataset.state,'typing');
const banner=fs.readFileSync(path.join(root,'src/components/journal/SiteBanner.astro'),'utf8');assert.ok(!banner.includes('HELLO, WORLD.'));assert.ok(!banner.includes('banner-social'));assert.ok(!banner.includes('quote-meta'));assert.ok(!banner.includes('data-quote-next'));assert.ok(banner.includes('home ? "sr-only" : "banner-title"'));assert.ok(banner.includes('{!home&&<button'));assert.ok(!banner.includes('aria-live="polite"'),'typing cannot announce each character automatically');
console.log('PASS quote typewriter: progressive Unicode text, exact seven-second complete hold, sequential rotation, background pause/resume, remaining hold, Beijing midnight and single route controller.');
