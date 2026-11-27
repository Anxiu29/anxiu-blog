const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = process.env.BLOG_REPO || path.resolve(__dirname, '..');
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
function load(file, globals) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: 9, module: 1 } }).outputText,
    { exports, URL, URLSearchParams, console, ...globals });
  return exports;
}
class Element {
  constructor(dataset = {}) { this.dataset = dataset; this.listeners = {}; this.attrs = {}; this.hidden = false; this.value = ''; this.textContent = ''; this.children = []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async emit(name, options = {}) { const event = { preventDefault() {}, ...options }; for (const fn of this.listeners[name] || []) await fn(event); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  querySelector(selector) { return this.matches?.[selector] || null; }
  querySelectorAll(selector) { return this.lists?.[selector] || []; }
}
function fixture(href = 'https://blog.test/friends/?keep=1#bookmarks') {
  const form = new Element(), query = new Element(), status = new Element(), empty = new Element(), pick = new Element(), picked = new Element();
  const tags = ['', '前端', '博客'].map(tag => new Element({ bookmarkTag: tag }));
  const cards = [
    ['Alpha', 'CSS 前端 学习交互', '前端', 'learn'],
    ['Beta', '博客 生活 日常', '博客', 'blogs'],
    ['Gamma', 'CSS 前端 性能', '前端', 'learn'],
  ].map(([name, text, tag, group]) => {
    const card = new Element({ filterText: `${name} ${text}`, tags: tag, bookmarkGroup: group });
    const link = new Element(); link.textContent = name; link.href = `https://${name.toLowerCase()}.test/`;
    card.matches = { '[data-bookmark-link]': link }; return card;
  });
  const groups = ['learn', 'blogs'].map(group => {
    const item = new Element({ bookmarkGroupSection: group });
    item.lists = { '[data-bookmark-card]': cards.filter(card => card.dataset.bookmarkGroup === group) };
    return item;
  });
  const copy = new Element(), info = new Element(), copyStatus = new Element(); info.value = '名称：安秀\n地址：https://blog.test/';
  const selectors = { '#bookmark-form': form, '#bookmark-query': query, '#bookmark-status': status, '#bookmark-empty': empty, '#pick-bookmark': pick, '#bookmark-pick': picked, '[data-copy-site-info]': copy, '#site-info-text': info, '#site-copy-status': copyStatus };
  const lists = { '[data-bookmark-tag]': tags, '[data-bookmark-card]': cards, '[data-bookmark-group-section]': groups };
  const doc = { querySelector: selector => selectors[selector] || null, querySelectorAll: selector => lists[selector] || [], createElement: () => new Element(), execCommand: () => false };
  const win = new Element(); win.location = { href, get search() { return new URL(this.href).search; } };
  win.history = { replaceState(_state, _title, url) { win.location.href = String(url); } };
  win.navigator = {};
  const api = load('src/scripts/bookmark-discovery.ts', { document: doc, window: win });
  const init = () => api.initializeBookmarkDiscovery(doc, win);
  return { init, form, query, tags, status, empty, pick, picked, cards, groups, win, doc, copy, info, copyStatus };
}
test('restores URL filters and hides a whole empty group; unknown tags normalize to all', () => {
  const page = fixture('https://blog.test/friends/?q=css%20%E4%BA%A4%E4%BA%92&tag=%E5%89%8D%E7%AB%AF&keep=1#bookmarks'); page.init();
  assert.deepEqual(page.cards.map(card => card.hidden), [false, true, true]);
  assert.deepEqual(page.groups.map(group => group.hidden), [false, true]);
  assert.equal(page.tags[1].attrs['aria-pressed'], 'true');
  assert.equal(new URL(page.win.location.href).searchParams.get('keep'), '1');
  const unknown = fixture('https://blog.test/friends/?tag=removed'); unknown.init();
  assert.equal(unknown.cards.filter(card => !card.hidden).length, 3);
  assert.equal(new URL(unknown.win.location.href).searchParams.has('tag'), false);
});
test('browser Back/Forward restores the URL state and initialization adds one input listener', async () => {
  const page = fixture(); page.init(); page.init();
  assert.equal(page.query.listeners.input.length, 1);
  page.query.value = 'no-such-site'; await page.query.emit('input');
  assert.equal(page.empty.hidden, false); assert.equal(page.pick.disabled, true);
  page.win.location.href = 'https://blog.test/friends/?tag=%E5%8D%9A%E5%AE%A2#bookmarks'; await page.win.emit('popstate');
  assert.equal(page.query.value, ''); assert.deepEqual(page.cards.map(card => card.hidden), [true, false, true]);
  assert.equal(page.pick.disabled, false);
});
test('reset clears only bookmark filters and random choice only uses visible sites', async () => {
  const page = fixture('https://blog.test/friends/?tag=%E5%8D%9A%E5%AE%A2&keep=1#bookmarks'); page.init();
  await page.pick.emit('click');
  assert.equal(page.picked.children[0].href, 'https://beta.test/');
  await page.form.emit('reset');
  assert.equal(page.cards.filter(card => !card.hidden).length, 3);
  const url = new URL(page.win.location.href); assert.equal(url.searchParams.get('keep'), '1'); assert.equal(url.hash, '#bookmarks');
});
test('clipboard denial selects real site information and never reports success', async () => {
  const page = fixture(); page.win.navigator.clipboard = { writeText: async () => { throw new Error('denied'); } }; page.init();
  await page.copy.emit('click');
  assert.equal(page.info.selected, true); assert.equal(page.info.focused, true);
  assert.match(page.copyStatus.textContent, /手动复制/); assert.doesNotMatch(page.copyStatus.textContent, /已复制/);
});
test('clipboard success copies actual rendered site information', async () => {
  const page = fixture(); let copied; page.win.navigator.clipboard = { writeText: async text => { copied = text; } }; page.init();
  await page.copy.emit('click'); assert.equal(copied, '名称：安秀\n地址：https://blog.test/'); assert.match(page.copyStatus.textContent, /已复制/);
});
test('notice dismissal is versioned, idempotent and survives blocked storage without losing focus', async () => {
  const notice = new Element({ discoveryNotice: 'v2' }), button = new Element(), next = new Element();
  notice.matches = { '[data-dismiss-discovery-notice]': button }; notice.nextElementSibling = { querySelector: () => next };
  const doc = { querySelectorAll: () => [notice] };
  const storage = new Map([['anxiu-notice-dismissed', 'v1']]);
  const win = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  const api = load('src/scripts/discovery-notice.ts', {});
  assert.equal(typeof api.initializeDiscoveryNotices, 'function', 'notice controller must implement versioned dismissal');
  api.initializeDiscoveryNotices(doc, win); api.initializeDiscoveryNotices(doc, win);
  assert.equal(notice.hidden, false); assert.equal(button.listeners.click.length, 1);
  await button.emit('click'); assert.equal(notice.hidden, true); assert.equal(storage.get('anxiu-notice-dismissed'), 'v2'); assert.equal(next.focused, true);
  const fresh = new Element({ discoveryNotice: 'v2' }); fresh.matches = notice.matches; api.initializeDiscoveryNotices({ querySelectorAll: () => [fresh] }, win); assert.equal(fresh.hidden, true);
  const blocked = new Element({ discoveryNotice: 'v3' }); const close = new Element(); blocked.matches = { '[data-dismiss-discovery-notice]': close };
  api.initializeDiscoveryNotices({ querySelectorAll: () => [blocked] }, { get localStorage() { throw new Error('blocked'); } });
  await close.emit('click'); assert.equal(blocked.hidden, true);
});
