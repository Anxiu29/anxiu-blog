const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = process.env.BLOG_REPO || path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const source = process.env.NAVIGATION_SOURCE || path.join(repo, 'src/scripts/journal-navigation.ts');
const selected = { checked: true };
const root = {classList:{contains(){return false;},toggle(){},remove(){}},getAttribute(){return null;},setAttribute(){}};
const document = {documentElement:root,querySelector(){return null;},querySelectorAll(selector){return selector.includes('input[type=radio]:checked') ? (selected.checked ? [selected] : []) : [];}};
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{target:99,module:1}}).outputText,{
 exports:exportsObject,document,require(){return new Proxy({}, {get(){return ()=>{};}});}
});
exportsObject.prepareJournalSwap({newDocument:document});
// When both persistent controls and incoming default radios briefly share a
// document, the incoming checked radio can uncheck the previous group member.
selected.checked = false;
exportsObject.initializeJournalPage();
assert.equal(selected.checked,true,'restore the actual checked preference after swapping');
selected.checked = false;
exportsObject.initializeJournalPage();
assert.equal(selected.checked,false,'a later initialization cannot replay an obsolete selection');
console.log('PASS: persisted appearance selection survives a swap without replaying stale state.');
