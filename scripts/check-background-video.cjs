const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.BLOG_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/scripts/background-video.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
class Events {
 constructor(){ this.handlers = {}; }
 addEventListener(type, fn){ (this.handlers[type] ||= []).push(fn); }
 emit(type){ for (const fn of this.handlers[type] || []) fn(); }
}
class Video extends Events {
 constructor(){ super(); this.attrs = {}; this.paused = true; this.playCalls = 0; this.loadCalls = 0; }
 hasAttribute(k){ return k in this.attrs; }
 removeAttribute(k){ delete this.attrs[k]; }
 set src(v){ this.attrs.src = v; }
 get src(){ return this.attrs.src; }
 pause(){ this.paused = true; }
 load(){ ++this.loadCalls; }
 play(){ ++this.playCalls; this.paused = false; return this.nextPlay ? this.nextPlay() : Promise.resolve(); }
}
function setup({reduce=false, saveData=false} = {}) {
 const media = Object.assign(new Events(), { matches: reduce });
 const connection = Object.assign(new Events(), {saveData});
 const document = Object.assign(new Events(), {hidden: false});
 const window = Object.assign(new Events(), {matchMedia: () => media});
 const module = {exports:{}};
 vm.runInNewContext(compiled, {exports:module.exports, module, document, window, navigator:{connection}, matchMedia:window.matchMedia});
 const video = new Video(); const paused = []; const messages = [];
 const player = module.exports.createBackgroundVideo(video, '/one.mp4', v=>paused.push(v), v=>messages.push(v));
 return {video, player, media, connection, document, window, paused, messages};
}
const settle = () => new Promise(r=>setImmediate(r));
(async()=>{
 for(const options of [{reduce:true},{saveData:true}]) {
  const {video,player} = setup(options);
  player.sync(true,false);
  assert.equal(video.playCalls,0,'preference must prevent automatic playback');
  assert.equal(video.hasAttribute('src'),false,'preference must prevent video download');
  player.sync(true,false,true); await settle();
  assert.equal(video.playCalls,1,'an explicit play action may override the preference for this movie');
  player.sync(true,false,false); assert.equal(video.playCalls,1);
  player.sync(false,false); player.sync(true,false);
  assert.equal(video.hasAttribute('src'),false,'leaving video mode must clear the explicit override');
 }
 console.log('PASS reduced-motion and save-data prevent downloads, explicit play remains available');
 {
  const {video,player,media} = setup();
  player.sync(true,false); await settle();
  media.matches=true; media.emit('change');
  assert.equal(video.paused,true); assert.equal(video.hasAttribute('src'),false);
  player.sync(true,false,true); await settle();
  assert.equal(video.paused,false);
  player.sync(true,false,false,'/two.mp4');
  assert.equal(video.hasAttribute('src'),false,'a new movie needs a new explicit action');
 }
 console.log('PASS preference changes stop playback and release the resource');
 {
  const {video,player,document,window} = setup();
  let resolve; video.nextPlay=()=>new Promise(r=>resolve=r);
  player.sync(true,false); document.hidden=true; document.emit('visibilitychange');
  video.paused=false; video.emit('playing'); resolve(); await settle();
  assert.equal(video.paused,true,'late playing event must not restart a hidden movie');
  document.hidden=false; document.emit('visibilitychange');
  player.sync(true,true,true); video.paused=false; video.emit('playing');
  assert.equal(video.paused,true,'manual pause must survive a late playing event');
  window.emit('pagehide'); assert.equal(video.paused,true);
 }
 console.log('PASS late playback cannot override hidden-page or manual-pause state');
 {
  const {video,player,messages} = setup();
  video.nextPlay=()=>Promise.reject(Object.assign(new Error('blocked'),{name:'NotAllowedError'}));
  player.sync(true,false); await settle();
  assert.equal(video.paused,true); assert.match(messages.at(-1),/静态封面/);
  video.nextPlay=undefined; player.sync(true,false,true); await settle();
  assert.equal(video.paused,false); player.sync(false,false);
  assert.equal(video.hasAttribute('src'),false);
 }
 console.log('PASS blocked autoplay can be retried and non-video mode releases resources');
})().catch(e=>{ console.error(e);process.exitCode=1; });

const settingsModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/scripts/background-settings.ts'),'utf8'),{compilerOptions:{target:99,module:1}}).outputText,{exports:settingsModule.exports,module:settingsModule});
assert.equal(settingsModule.exports.DEFAULT_BACKGROUND.mode,'image','first visit must use a static image');
assert.equal(settingsModule.exports.readBackground({getItem:()=>JSON.stringify({version:1,mode:'video',video:'luo-xiaohei'})}).mode,'video','saved Luo wallpaper remains selected');
console.log('PASS static default and retained Luo video preferences');
