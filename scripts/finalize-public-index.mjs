import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function walk(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
export function finalizePublicIndex(dist) {
 const allowed=new Set();
 for(const file of walk(dist).filter(file=>file.endsWith('.html'))) {
  const html=fs.readFileSync(file,'utf8');
  if (/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) continue;
  if(!/\sdata-pagefind-body(?:[\s=>])/.test(html)) continue;
  const route='/'+path.relative(dist,file).replaceAll('\\','/').replace(/index\.html$/,'');
  allowed.add(route);
 }
 let removed=0;
 for(const file of fs.readdirSync(dist).filter(file=>/^sitemap-\d+\.xml$/.test(file))) {
  const target=path.join(dist,file),xml=fs.readFileSync(target,'utf8');
  const next=xml.replace(/<url>[\s\S]*?<\/url>/g,block=>{
   const loc=block.match(/<loc>([^<]+)<\/loc>/)?.[1];
   if(loc && allowed.has(new URL(loc.replaceAll('&amp;','&')).pathname)) return block;
   removed++;return '';
  });
  fs.writeFileSync(target,next);
 }
 return {publicRoutes:[...allowed].sort(),removedSitemapEntries:removed};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(finalizePublicIndex(path.resolve(process.argv[2]||'dist'))));
