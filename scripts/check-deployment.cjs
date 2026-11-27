const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const context={exports:{},URL};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/site-origin.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const resolve=context.exports.resolveSiteOrigin;
assert.equal(resolve({}), 'https://anxiu-blog.vercel.app');
assert.equal(resolve({VERCEL_PROJECT_PRODUCTION_URL:'example.vercel.app'}),'https://example.vercel.app');
assert.equal(resolve({SITE_URL:' https://blog.example.com/ ',VERCEL_PROJECT_PRODUCTION_URL:'preview.vercel.app'}),'https://blog.example.com');
for(const SITE_URL of ['http://example.com','https://example.com/path','https://user:password@example.com','https://example.com/?query=1'])assert.throws(()=>resolve({SITE_URL}));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.ok(pkg.devDependencies.tsx && pkg.devDependencies['only-allow']);assert.ok(!/\bnpx\b/.test(pkg.scripts.build),'build tools must be declared and locked instead of downloaded ad hoc');
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
assert.equal(config.framework,'astro');assert.equal(config.outputDirectory,'dist');assert.match(config.installCommand,/--frozen-lockfile/);
const ignore=fs.readFileSync(path.join(root,'.vercelignore'),'utf8');
for(const item of ['.local/','.env.*','**/node_modules/','deploy/chronoframe/'])assert.ok(ignore.split(/\r?\n/).includes(item));
if(process.argv.includes('--built')){
 const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
 const origin=new URL(html.match(/rel="canonical" href="([^"]+)"/)[1]).origin;
 assert.equal(new URL(fs.readFileSync(path.join(root,'dist/sitemap-index.xml'),'utf8').match(/<loc>([^<]+)<\/loc>/)[1]).origin,origin);
 const photos=fs.readFileSync(path.join(root,'dist/photos/index.html'),'utf8');
 if(process.env.VERCEL==='1') { assert.ok(photos.includes('相册尚未公开'));assert.ok(!/href="https?:\/\/(?:localhost|127\.0\.0\.1)/.test(photos)); }
 for(const item of ['.local','.env','deploy/chronoframe'])assert.ok(!fs.existsSync(path.join(root,'dist',item)));
}
console.log('PASS deployment: production origin precedence/validation, locked install, private source exclusions and built metadata.');
