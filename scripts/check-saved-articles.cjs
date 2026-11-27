const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=process.env.BLOG_REPO||path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript')),api={};
const file=path.join(repo,'src/scripts/saved-articles.ts');
if(fs.existsSync(file))vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:99,module:1}}).outputText,{exports:api,URL,Date,Map,Set});
function fixture(){const values=new Map([['anxiu-todo-v1','keep tasks'],['anxiu-post-view-v1','compact']]);return{values,getItem:k=>values.get(k)||null,setItem(k,v){values.set(k,v);}};}
test('save and remove reread the latest state and touch only the article collection',()=>{
 const f=fixture();api.setArticleSaved(f,'/posts/one/',true,100);api.setArticleSaved(f,'/posts/two/',true,200);api.setArticleSaved(f,'/posts/one/',false,300);
 assert.equal(api.readSavedArticles(f).length,1);assert.equal(api.readSavedArticles(f)[0].path,'/posts/two/');assert.equal(f.values.get('anxiu-todo-v1'),'keep tasks');assert.equal(f.values.get('anxiu-post-view-v1'),'compact');
});
test('repeated saves are idempotent and records have deterministic newest-first order',()=>{
 const f=fixture();api.setArticleSaved(f,'/posts/one/',true,100);api.setArticleSaved(f,'/posts/two/',true,200);api.setArticleSaved(f,'/posts/one/',true,300);
 const items=api.readSavedArticles(f);assert.equal(items.length,2);assert.equal(items[0].path,'/posts/two/');assert.equal(items[1].savedAt,100);
});
test('corrupt and unsupported data cannot be silently overwritten',()=>{
 const f=fixture();for(const raw of ['{bad',JSON.stringify({version:2,items:[]}),JSON.stringify({version:1,items:[{path:'javascript:alert(1)',savedAt:10}]})]){
  f.values.set(api.SAVED_ARTICLES_KEY,raw);assert.throws(()=>api.setArticleSaved(f,'/posts/one/',true,100));assert.equal(f.values.get(api.SAVED_ARTICLES_KEY),raw);
 }
});
test('unsafe destinations and failed writes never become a saved success',()=>{
 const f=fixture();for(const path of ['https://other.test/posts/a/','/posts/../secret/','/posts/a/?token=secret','//other.test/'])assert.throws(()=>api.setArticleSaved(f,path,true));
 api.setArticleSaved(f,'/posts/one/',true,100);const old=f.values.get(api.SAVED_ARTICLES_KEY);f.setItem=()=>{throw Error('quota');};assert.throws(()=>api.setArticleSaved(f,'/posts/two/',true,200));assert.equal(f.values.get(api.SAVED_ARTICLES_KEY),old);
});
test('duplicate records collapse to the newest timestamp and collection size is bounded',()=>{
 const f=fixture();f.values.set(api.SAVED_ARTICLES_KEY,JSON.stringify({version:1,items:[{path:'/posts/one/',savedAt:1},{path:'/posts/one/',savedAt:2}]}));assert.equal(api.readSavedArticles(f).length,1);assert.equal(api.readSavedArticles(f)[0].savedAt,2);
 for(let n=0;n<205;n++)api.setArticleSaved(f,`/posts/item-${n}/`,true,n+10);assert.equal(api.readSavedArticles(f).length,200);
});
