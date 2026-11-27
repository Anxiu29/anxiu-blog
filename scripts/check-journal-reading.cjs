const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = process.env.BLOG_REPO || path.resolve(__dirname, '..');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const source = process.env.READING_SOURCE || path.join(repo, 'src/scripts/journal-reading.ts');
function load(context = {}) {
  const exports = {};
  if (fs.existsSync(source)) vm.runInNewContext(requireRepo('typescript').transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {target: 99, module: 1}}).outputText, {exports, ...context});
  assert.equal(typeof exports.getArticleProgress, 'function', 'reading controller exports progress behavior');
  return exports;
}

// Catches treating a viewport-fitting body as an almost-zero scroll range.
test('progress completes a fully visible short article and measures long article below the sticky header', () => {
  const {getArticleProgress} = load();
  assert.equal(getArticleProgress({top: 200, height: 300}, 800, 100), 100);
  assert.equal(getArticleProgress({top: 900, height: 300}, 800, 100), 0);
  assert.equal(getArticleProgress({top: 650, height: 300}, 800, 100), 50);
  assert.equal(getArticleProgress({top: 100, height: 1700}, 800, 100), 0);
  assert.equal(getArticleProgress({top: -400, height: 1700}, 800, 100), 50);
  assert.equal(getArticleProgress({top: -900, height: 1700}, 800, 100), 100);
  assert.equal(getArticleProgress({top: 0, height: 0}, 800, 100), 0);
});

// Catches unguarded Clipboard API use and a rejected native share blocking copy.
test('sharing attempts native share, clipboard, then manual copy without requiring either API', async () => {
  const {shareArticleLink} = load();
  const writes = [];
  assert.equal(await shareArticleLink('/post/', 'Title', false, {}), 'manual');
  assert.equal(await shareArticleLink('/post/', 'Title', true, {share: async () => {}, clipboard: {writeText: async () => { throw Error('should not copy after share'); }}}), 'shared');
  assert.equal(await shareArticleLink('/post/', 'Title', true, {share: async () => { throw Error('denied'); }, clipboard: {writeText: async (value) => writes.push(value)}}), 'copied');
  assert.deepEqual(writes, ['/post/']);
  assert.equal(await shareArticleLink('/post/', 'Title', false, {clipboard: {writeText: async () => { throw Error('denied'); }}}), 'manual');
  assert.equal(await shareArticleLink('/post/', 'Title', true, {share: async () => { const error = Error(); error.name = 'AbortError'; throw error; }, clipboard: {writeText: async () => { throw Error('should not copy after cancellation'); }}}), 'cancelled');
});

function fixture() {
  const listeners = new Map();
  const doc = {activeElement: null};
  function element(id = '') {
    const handlers = {};
    const classes = new Set();
    return {id, dataset: {}, hidden: false, value: '', style: {}, textContent: '', attrs: {}, children: [], isConnected: true,
      classList: {contains: (name) => classes.has(name), toggle(name, value) {if(value) classes.add(name); else classes.delete(name); return value;}},
      setAttribute(key, value) {this.attrs[key] = value;}, removeAttribute(key) {delete this.attrs[key];},
      addEventListener(type, fn) {(handlers[type] ||= []).push(fn);},
      removeEventListener(type, fn) {handlers[type]=(handlers[type]||[]).filter(item=>item!==fn);},
    async emit(type, event = {}) {for (const fn of handlers[type] || []) await fn({target: this, ...event});},
      closest() {return this.hiddenAncestor || null;},
      focus() {doc.activeElement = this;}, select() {this.selected = true;},
      append(child) {this.children.push(child);}, replaceChildren(...children) {this.children = children;},
      getBoundingClientRect() {return this.rect || {top: 100, height: 1700};},
      querySelector(selector) {return this.nodes?.[selector] || null;},
      get hash() {return this.href?.slice(this.href.indexOf('#')) || '';},
    };
  }
  const nodes = {};
  for(const selector of ['.reading-tools', '.article-body', '#reading-size', '#reading-progress-fill', '#reading-percent', '#toggle-reading-focus', '#exit-reading-focus', '.article-column']) nodes[selector] = element();
  const toc = element();
  const region = element();
  let headings = [];
  Object.assign(doc, {
    body: element(), documentElement: element(),
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: (selector) => selector === '[data-toc-items]' ? [toc] : selector === '[data-toc-region]' ? [region] : selector === '[data-toc-link]' ? toc.children : headings,
    createElement: () => element(),
    addEventListener(type, fn) {(listeners.get(type) || (listeners.set(type, []), listeners.get(type))).push(fn);},
    removeEventListener(type, fn) {listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn));},
    async emit(type, event = {}) {for (const fn of listeners.get(type) || []) await fn(event);},
  });
  const frames = [];
  const observers = [];
  class Observer {constructor(callback) {this.callback = callback; observers.push(this);} observe(_target, options) {this.options = options;} disconnect() {this.disconnected=true;}}
  const api = load({document: doc, window: {innerHeight: 800, addEventListener() {}, removeEventListener() {}}, localStorage: {getItem() {throw Error('blocked');}, setItem() {throw Error('blocked');}}, requestAnimationFrame: (fn) => {frames.push(fn);}, getComputedStyle: () => ({scrollPaddingTop: '100px'}), MutationObserver: Observer, ResizeObserver: Observer});
  function flush() {while(frames.length) frames.shift()();}
  return {api, doc, nodes, toc, region, observers, flush, listeners, setHeadings(value) {headings = value;}, heading(id, text, top, tagName = 'H2') {return {...element(id), textContent: text, tagName, rect: {top, height: 40}};}};
}

test('focus mode exits with Escape or its persistent exit control and returns focus once', async () => {
  const f = fixture();
  f.api.initializeReadingTools(); f.api.initializeReadingTools(); f.flush();
  await f.nodes['#toggle-reading-focus'].emit('click');
  assert.equal(f.doc.body.classList.contains('reading-focus'), true);
  assert.equal(f.nodes['#exit-reading-focus'].hidden, false);
  await f.doc.emit('keydown', {key: 'Escape', defaultPrevented: false, preventDefault() {}});
  assert.equal(f.doc.body.classList.contains('reading-focus'), false);
  assert.equal(f.nodes['#exit-reading-focus'].hidden, true);
  assert.equal(f.doc.activeElement, f.nodes['#toggle-reading-focus']);
  await f.nodes['#toggle-reading-focus'].emit('click');
  await f.nodes['#exit-reading-focus'].emit('click');
  assert.equal(f.doc.body.classList.contains('reading-focus'), false);
  assert.equal(f.listeners.get('keydown').length, 1);
});

test('TOC discovers unlocked headings, updates active location and does not duplicate initialization', () => {
  const f = fixture();
  f.api.initializeArticleToc(); f.api.initializeArticleToc(); f.flush();
  assert.equal(f.region.hidden, true);
  f.setHeadings([f.heading('first', '第一节', -200), f.heading('second', '第二节', 400, 'H3')]);
  for(const observer of f.observers) observer.callback();
  f.flush();
  assert.equal(f.region.hidden, false);
  assert.equal(f.toc.children.length, 2);
  assert.equal(f.toc.children[0].textContent, '第一节');
  assert.equal(f.toc.children[0].attrs['aria-current'], 'location');
  assert.equal(f.toc.children[1].className, 'nested');
  f.setHeadings([f.heading('first', '第一节', -500), f.heading('second', '第二节', 80, 'H3')]);
  for(const observer of f.observers) observer.callback(); f.flush();
  assert.equal(f.toc.children[1].attrs['aria-current'], 'location');
  assert.equal(f.toc.children[0].attrs['aria-current'], undefined);
  assert.equal(f.listeners.get('password:decrypted').length, 1);
});

// Tutorial tabs must not insert unreachable anchors or hijack active-section state.
test('TOC excludes hidden tutorial panels and updates when the selected panel changes', () => {
  const f = fixture();
  const first = f.heading('visible-panel', '当前方案', -200);
  const second = f.heading('hidden-panel', '备用方案', 0);
  second.hiddenAncestor = {};
  f.setHeadings([first, second]);
  f.api.initializeArticleToc(); f.flush();
  assert.equal(f.toc.children.length, 1);
  assert.equal(f.toc.children[0].textContent, '当前方案');
  assert.equal(f.toc.children[0].attrs['aria-current'], 'location');
  const observer = f.observers.find(item => item.options?.attributeFilter?.includes('hidden'));
  assert.ok(observer, 'hidden attribute changes must refresh the TOC');
  first.hiddenAncestor = {}; second.hiddenAncestor = null;
  observer.callback(); f.flush();
  assert.equal(f.toc.children.length, 1);
  assert.equal(f.toc.children[0].textContent, '备用方案');
});

test('page swap detaches old article controls and observers before another article mounts',async()=>{
 const f=fixture();f.api.initializeReadingTools();f.api.initializeArticleToc();f.flush();
 await f.doc.emit('astro:before-swap');
 for(const type of ['keydown','scroll','password:decrypted']) assert.equal((f.listeners.get(type)||[]).length,0,type);
 assert.ok(f.observers.every(o=>o.disconnected));
});
