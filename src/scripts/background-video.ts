/** Own the decorative video's lifetime; never fetch the movie for an image background. */
export function createBackgroundVideo(video:HTMLVideoElement,src:string,onPaused:(paused:boolean)=>void,say:(message:string)=>void){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let active=false,manualPaused=false,overrideReduced=false,failed=false,pending=false,attempt=0;
 video.muted=true;video.loop=true;video.playsInline=true;
 const release=()=>{++attempt;pending=false;video.pause();if(video.hasAttribute('src')){video.removeAttribute('src');video.load();}};
 function update(){
  if(!active)return;
  if(manualPaused||document.hidden||(reduced.matches&&!overrideReduced)||failed){++attempt;pending=false;video.pause();onPaused(true);return;}
  if(!video.hasAttribute('src'))video.src=src;
  if(!video.paused||pending)return;
  const token=++attempt;pending=true;
  void video.play().then(()=>{if(token===attempt&&active){pending=false;onPaused(false);}}).catch(error=>{
   if(token!==attempt||!active)return;pending=false;failed=true;video.pause();onPaused(true);
   say(error?.name==='NotAllowedError'?'浏览器暂停了自动播放，先显示静态封面；点击播放即可继续。':'动态壁纸暂时无法播放，已显示静态封面，可点击播放重试。');
  });
 }
 video.addEventListener('error',()=>{if(!active||!video.hasAttribute('src'))return;failed=true;release();onPaused(true);say('动态壁纸暂时无法加载，已显示静态封面，可点击播放重试。');});
 video.addEventListener('playing',()=>{if(active){onPaused(false);say('动态壁纸正在静音循环播放。');}});
 video.addEventListener('pause',()=>{if(active)onPaused(true);});
 document.addEventListener('visibilitychange',update);
 reduced.addEventListener('change',()=>{overrideReduced=false;update();if(active&&reduced.matches)say('已开启减少动态效果，先显示静态封面；需要时可手动播放。');});
 window.addEventListener('pagehide',()=>{++attempt;pending=false;video.pause();});
 window.addEventListener('pageshow',()=>{if(active)update();});
 return {sync(nextActive:boolean,paused:boolean,explicit=false){
  const entering=nextActive&&!active;active=nextActive;manualPaused=paused;video.hidden=!active;
  if(!active){failed=false;overrideReduced=false;release();return;}
  if(explicit){failed=false;overrideReduced=true;}
  if(entering){failed=false;overrideReduced=explicit;}
  update();if(entering&&reduced.matches&&!explicit)say('已开启减少动态效果，先显示静态封面；需要时可手动播放。');
 }};
}
