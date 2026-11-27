import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=process.env.BLOG_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {finalizePublicIndex}=await import(pathToFileURL(path.join(repo,'scripts/finalize-public-index.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blog-index-'));
try {
 for(const [route,body]of [['posts/public','<main data-pagefind-body>公开</main>'],['photos','<meta name="robots" content="noindex,follow"><main data-pagefind-body>私密入口</main>'],['posts/template','<main>模板</main>']]) {const file=path.join(dir,route,'index.html');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
 fs.writeFileSync(path.join(dir,'sitemap-0.xml'),'<urlset>'+['/posts/public/','/photos/','/posts/template/','/missing/'].map(route=>`<url><loc>https://blog.test${route}</loc></url>`).join('')+'</urlset>');
 const result=finalizePublicIndex(dir);assert.deepEqual(result.publicRoutes,['/posts/public/']);assert.equal(result.removedSitemapEntries,3);
 const xml=fs.readFileSync(path.join(dir,'sitemap-0.xml'),'utf8');assert.ok(xml.includes('/posts/public/'));assert.ok(!xml.includes('/photos/'));assert.equal(finalizePublicIndex(dir).removedSitemapEntries,0);
 console.log('PASS: public index derives sitemap eligibility from rendered noindex and body markers, idempotently.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

if(process.argv.includes('--built')) {
 const dist=path.join(repo,'dist');
 const fragments=fs.readdirSync(path.join(dist,'pagefind/fragment')).filter(name=>name.endsWith('.pf_fragment'));
 assert.ok(fragments.length>0);
 const indexed=[];
 for(const name of fragments) {
  const text=gunzipSync(fs.readFileSync(path.join(dist,'pagefind/fragment',name))).toString();
  const item=JSON.parse(text.slice(text.indexOf('{'))),url=new URL(item.url,'https://blog.test');
  const html=fs.readFileSync(path.join(dist,decodeURIComponent(url.pathname),'index.html'),'utf8');
  assert.ok(html.includes('data-pagefind-body'),item.url);
  assert.ok(!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html),item.url);
  assert.ok(!/上午好，欢迎来访/.test(item.content),'clock and sidebar chrome are excluded');
  indexed.push(url.pathname);
 }
 assert.ok(!indexed.some(route=>/\/(?:saved|photos|search|todo)\//.test(route)));
 assert.ok(indexed.includes('/posts/webhid-tool-guide/'));
 console.log('PASS: '+indexed.length+' actual Pagefind fragments contain public content only.');
}
