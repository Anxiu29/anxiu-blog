const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=process.env.BLOG_REPO||path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(repo,'src/scripts/journal-search.ts'),'utf8'),{compilerOptions:{target:99,module:1}}).outputText,{exports:api,Map,URL,AbortController,setTimeout,clearTimeout});
const records=[{title:'标题',description:'说明',url:'/posts/example/',type:'文章',text:'公开正文'}];
test('search index is lazy and shares the same in-flight and successful request',async()=>{
 let calls=0,resolve;const load=api.createSearchLoader(()=>{calls++;return new Promise(r=>resolve=r);});
 assert.equal(calls,0);const first=load('/api/search-index.json?v=1'),second=load('/api/search-index.json?v=1');assert.equal(calls,1);
 resolve({ok:true,json:async()=>records});assert.deepEqual(await first,await second);await load('/api/search-index.json?v=1');assert.equal(calls,1);
});
test('failed and malformed indexes may retry and never cache an unsuccessful promise',async()=>{
 let calls=0;const load=api.createSearchLoader(async()=>{calls++;return calls===1?{ok:false}:{ok:true,json:async()=>calls===2?{}:records};});
 await assert.rejects(load('/index'));await assert.rejects(load('/index'));assert.equal((await load('/index')).length,1);assert.equal(calls,3);
});
test('unsafe destinations and malformed records are excluded without inserting HTML',async()=>{
 const load=api.createSearchLoader(async()=>({ok:true,json:async()=>[...records,{...records[0],url:'javascript:alert(1)'},{...records[0],url:'//other.test/'},null,{title:'incomplete'}]}));
 const data=await load('/index');assert.equal(data.length,1);assert.equal(data[0].url,'/posts/example/');
});
test('a stalled index request times out and a later attempt can succeed',async()=>{
 let calls=0;const load=api.createSearchLoader((_url,{signal})=>{calls++;return calls===1?new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')))) : Promise.resolve({ok:true,json:async()=>records});},5);
 await assert.rejects(load('/index'));assert.equal((await load('/index')).length,1);
});
