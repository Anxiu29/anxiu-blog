const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');const ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const values=new Map();
const indexedDB={open(){const request={};queueMicrotask(()=>{request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={};tx.objectStore=()=>({get(key){return schedule(()=>values.get(key));},put(value,key){return schedule(()=>{values.set(key,value);});},delete(key){return schedule(()=>values.delete(key));}});function schedule(fn){const req={};queueMicrotask(()=>{req.result=fn();req.onsuccess?.();tx.oncomplete?.();});return req;}return tx;}};request.onsuccess();});return request;}};
const context={exports:{},Blob,indexedDB,console};vm.runInNewContext(compile('scripts/background-storage.ts'),context);const api=context.exports;
(async()=>{
 for(const type of ['image/gif','image/apng','image/webp','image/png','image/jpeg','image/avif']){
  const bytes=Uint8Array.from([71,73,70,56,57,97,0,1,2,3,255]);const blob=new Blob([bytes],{type});const photo={blob,name:'animation'};
  assert.equal(api.validPhoto(photo),true,type+' must be accepted for local background');
  await api.storePhoto(photo);const restored=await api.readPhoto();
  assert.equal(restored.blob,blob,'storage keeps the original animation blob');assert.deepEqual(new Uint8Array(await restored.blob.arrayBuffer()),bytes,'no frame flattening or image recompression');
 }
 for(const blob of [new Blob([],{type:'image/gif'}),new Blob(['bad'],{type:'image/svg+xml'}),new Blob([new Uint8Array(api.MAX_BACKGROUND_BYTES+1)],{type:'image/gif'})])assert.equal(api.validPhoto({blob,name:'bad'}),false);
 const videoBlob=new Blob(['original-mp4-bytes'],{type:'video/mp4'});
 const localVideo={blob:videoBlob,name:'wallpaper.mp4',poster:new Blob(['still'],{type:'image/jpeg'})};
 await api.storeLocalVideo(localVideo);
 assert.equal((await api.readLocalVideo()).blob,videoBlob);
 await api.deletePhoto();assert.ok(await api.readLocalVideo(),'deleting a photo must preserve the video');
 await api.storePhoto({blob:new Blob(['photo'],{type:'image/png'}),name:'photo'});
 await api.deleteLocalVideo();assert.ok(await api.readPhoto(),'deleting a video must preserve the photo');assert.equal(await api.readLocalVideo(),undefined);
 for(const blob of [new Blob([],{type:'video/mp4'}),new Blob(['bad'],{type:'video/webm'}),new Blob([new Uint8Array(api.MAX_BACKGROUND_VIDEO_BYTES+1)],{type:'video/mp4'})])assert.equal(api.validLocalVideo({...localVideo,blob}),false);
 assert.equal(api.validLocalVideo({...localVideo,poster:undefined}),false);
 await api.deletePhoto();assert.equal(await api.readPhoto(),undefined);
 const settings={exports:{}};vm.runInNewContext(compile('scripts/background-settings.ts'),settings);
 const retained=settings.exports.normalizeBackground({version:1,mode:'video',video:'luo-xiaohei',videoPaused:true,overlay:65,blur:3});
 assert.equal(retained.mode,'video');assert.equal(retained.video,'luo-xiaohei');assert.equal(retained.videoPaused,true);
 assert.equal(settings.exports.DEFAULT_BACKGROUND.mode,'image');
 const local=settings.exports.normalizeBackground({version:1,mode:'video',video:'local',videoPaused:true});
 assert.equal(local.mode,'video');assert.equal(local.video,'local');assert.equal(local.videoPaused,true);
 for(const video of ['night-cuddle','unknown']){
  const migrated=settings.exports.normalizeBackground({version:1,mode:'video',video,overlay:65,blur:3});
  assert.equal(migrated.mode,'image','removed kitten presets fall back to image mode');assert.equal(migrated.wallpaper,'cloud-pals');assert.equal(migrated.overlay,65);assert.equal(migrated.blur,3);
 }
 const ui=fs.readFileSync(path.join(__dirname,'../src/components/journal/BackgroundSettings.astro'),'utf8');
 assert.ok(ui.includes('data-video-wallpaper'));assert.ok(ui.includes('site-wallpaper-video'));
 const data=fs.readFileSync(path.join(__dirname,'../src/data/background-images.ts'),'utf8');
 assert.equal((data.match(/id: "luo-xiaohei"/g)||[]).length,1);assert.ok(!data.includes('night-cuddle'));assert.ok(ui.includes('GIF'));assert.ok(ui.includes('APNG'));
 console.log('PASS local animated backgrounds: GIF/APNG/WebP allowed, raw bytes survive storage, limits retained, Luo wallpaper retained and removed presets migrate safely.');
})().catch(e=>{console.error(e);process.exitCode=1;});
