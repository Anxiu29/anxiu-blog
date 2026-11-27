const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const path=require('node:path');
const file=path.join(__dirname,'../src/scripts/music-pet-drag.ts');
const compiled=ts.transpileModule(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'export function initializeMusicPetDrag() {}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function setup(saved,blocked=false){
 class Target {
  constructor(){this.handlers={};this.dataset={};this.attrs={};this.values={};this.style={setProperty:(k,v)=>this.values[k]=v,removeProperty:k=>delete this.values[k]};}
  addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  setPointerCapture(id){this.captured=id;}
  releasePointerCapture(id){if(this.captured===id)this.captured=undefined;}
  hasPointerCapture(id){return this.captured===id;}
  emit(type,data={}){const e={type,target:this,pointerId:1,isPrimary:true,button:0,clientX:1100,clientY:450,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...data};for(const fn of this.handlers[type]||[])fn(e);return e;}
 }
 const pet=new Target(),handle=new Target(),menu=new Target(),lyrics=new Target(),win=new Target();menu.focus=()=>{menu.focused=true;};win.innerWidth=1280;win.innerHeight=850;
 pet.getBoundingClientRect=()=>({left:parseFloat(pet.values.left??1100),top:parseFloat(pet.values.top??400),width:148,height:300});
 pet.querySelector=selector=>selector==='[data-pet-menu]'?menu:selector==='[data-pet-action="lyrics"]'?lyrics:handle;
 let stored=saved===undefined?null:typeof saved==='string'?saved:JSON.stringify(saved);
 const context={exports:{},document:{querySelector:()=>pet},window:win,localStorage:{getItem(){if(blocked)throw Error('blocked');return stored;},setItem(k,v){if(blocked)throw Error('blocked');stored=v;},removeItem(){if(blocked)throw Error('blocked');stored=null;}},console};
 vm.runInNewContext(compiled,context);const init=context.exports.initializeMusicPetDrag;init();
 return {pet,handle,menu,lyrics,win,init,stored:()=>stored===null?null:JSON.parse(stored)};
}
{
 const s=setup();s.handle.emit('pointerdown');s.handle.emit('pointermove',{clientX:950,clientY:350});
 assert.equal(s.pet.values.left,'950px','dragging the character moves the whole companion');assert.equal(s.pet.values.top,'300px');
 assert.equal(s.pet.dataset.dragging,'true');s.handle.emit('pointerup',{clientX:950,clientY:350});
 assert.equal(s.pet.dataset.dragging,'false');assert.equal(s.stored().x,950);assert.equal(s.stored().y,300);
 assert.equal(s.handle.captured,undefined);const click=s.handle.emit('click');assert.equal(click.prevented,true);
 s.init();assert.equal(s.handle.handlers.pointerdown.length,1,'route initialization never binds twice');
 console.log('PASS pet dragging: shared companion moves, pointer capture ends, position saves and route binding stays single.');
}
{
 const s=setup();s.handle.emit('pointerdown');s.handle.emit('pointermove',{clientX:1102,clientY:451});s.handle.emit('pointerup');assert.equal(s.pet.values.left,undefined,'ordinary clicks do not move or persist the pet');assert.equal(s.stored(),null);
 s.handle.emit('pointerdown',{button:2});s.handle.emit('pointermove',{clientX:700});assert.equal(s.pet.values.left,undefined);
 s.handle.emit('pointerdown');s.handle.emit('pointermove',{pointerId:2,clientX:600});assert.equal(s.pet.values.left,undefined,'another pointer cannot hijack a drag');
 s.handle.emit('pointermove',{clientX:-2000,clientY:4000});assert.equal(s.pet.values.left,'12px');assert.equal(s.pet.values.top,'538px','whole companion including controls is kept in view');
 s.handle.emit('pointercancel');assert.equal(s.pet.values.left,'1100px');assert.equal(s.pet.values.top,'400px');assert.equal(s.stored(),null,'cancelled drag restores start without saving');
 console.log('PASS pet pointer safety: click threshold, primary button, pointer isolation, viewport limits and cancellation.');
}
{
 const s=setup({x:99999,y:-100});assert.equal(s.pet.values.left,'1120px');assert.equal(s.pet.values.top,'12px');
 s.win.innerWidth=1000;s.win.innerHeight=600;s.win.emit('resize');assert.equal(s.pet.values.left,'840px');assert.equal(s.pet.values.top,'12px');
 const k=s.handle.emit('keydown',{key:'ArrowLeft'});assert.equal(k.prevented,true);assert.equal(s.pet.values.left,'830px');
 s.handle.emit('keydown',{key:'ArrowDown',shiftKey:true});assert.equal(s.pet.values.top,'13px');
 s.handle.emit('keydown',{key:'Home'});assert.equal(s.pet.values.left,undefined);assert.equal(s.stored(),null);
 for(const saved of ['bad JSON',{x:'bad',y:30},{x:null,y:20}])assert.equal(setup(saved).pet.values.left,undefined);
 const blocked=setup(undefined,true);blocked.handle.emit('pointerdown');blocked.handle.emit('pointermove',{clientX:800});blocked.handle.emit('pointerup');assert.equal(blocked.pet.values.left,'800px');
 console.log('PASS pet position: restore and resize clamp safely, keyboard movement/reset work, invalid or blocked storage is harmless.');
}

{
 const s=setup();s.menu.emit('click');assert.equal(s.pet.dataset.controlsOpen,'true');assert.equal(s.menu.attrs['aria-expanded'],'true');
 s.lyrics.emit('click');assert.equal(s.pet.dataset.controlsOpen,'false','choosing lyrics closes the shared control area');
 s.menu.emit('click');s.pet.emit('keydown',{key:'Escape'});assert.equal(s.pet.dataset.controlsOpen,'false');assert.equal(s.menu.focused,true);
 s.menu.emit('click');s.handle.emit('pointerdown');s.handle.emit('pointermove',{clientX:950,clientY:350});assert.equal(s.pet.dataset.controlsOpen,'false','dragging dismisses touch tools');
 console.log('PASS touch controls: explicit toggle, lyric exclusivity, Escape and dragging dismissal.');
}
