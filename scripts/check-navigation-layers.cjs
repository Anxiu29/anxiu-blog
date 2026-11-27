const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=process.env.BLOG_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const header=fs.readFileSync(path.join(root,'src/components/journal/BlogHeader.astro'),'utf8');
const source=header.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(overlay){
 const handlers={};const summary={focused:false,focus(){this.focused=true;}};
 const menu={open:true,addEventListener(){},querySelector(){return summary;},contains(){return false;}};
 const document={querySelectorAll(){return[menu];},querySelector(){return overlay?{}:null;},addEventListener(type,fn){handlers[type]=fn;}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:99,module:1}}).outputText,{document,Node:class{}});
 const event={key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
 handlers.keydown(event);return{menu,event,summary};
}
const above=setup(true);
assert.equal(above.event.defaultPrevented,false,'a background menu must not prevent the top dialog/popover from receiving native Escape');
assert.equal(above.summary.focused,false,'a background menu must not steal focus from the overlay');
const ordinary=setup(false);
assert.equal(ordinary.menu.open,false);assert.equal(ordinary.event.defaultPrevented,true);assert.equal(ordinary.summary.focused,true);
console.log('PASS Escape gives dialogs/popovers priority, then closes the desktop menu and restores its focus');
