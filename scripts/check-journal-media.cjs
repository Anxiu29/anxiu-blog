const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const repo = process.env.BLOG_REPO || path.resolve(__dirname, '..');
const source = process.env.MEDIA_SOURCE || path.join(repo, 'src/utils/post-media.ts');
const exportsObject = {};
if (fs.existsSync(source)) vm.runInNewContext(createRequire(path.join(repo, 'package.json'))('typescript').transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {target: 99, module: 1}}).outputText, {exports: exportsObject});
const resolve = (...args) => {assert.equal(typeof exportsObject.resolvePostMedia, 'function', 'frontmatter media resolver exists'); return exportsObject.resolvePostMedia(...args);};
test('real public cover resolves measured dimensions and crop; missing cover remains absent', async () => {
  const asset = async (source) => source === '/images/projects/anxiu-interface.jpg' ? {src: source, width: 1280, height: 800} : undefined;
  const cover = await resolve('new-entry', {image: '/images/projects/anxiu-interface.jpg', imageAlt: '设备面板', imagePosition: 'left'}, asset);
  assert.equal(cover.src, '/images/projects/anxiu-interface.jpg');
  assert.equal(cover.width, 1280); assert.equal(cover.height, 800);
  assert.equal(cover.caption, '设备面板'); assert.equal(cover.position, 'left');
  assert.equal(await resolve('new-entry', {}, asset), undefined);
  assert.equal(await resolve('new-entry', {image: '/missing.jpg'}, asset), undefined);
});
test('local relative cover resolves by article directory and real HID screenshot is available as a list cover', async () => {
  const seen = [];
  const local = await resolve('notes/entry.md', {image: './images/cover.webp'}, async (source) => {
    seen.push(source); return source === '/src/content/posts/notes/images/cover.webp' ? {src: '/_astro/cover.hash.webp', width: 640, height: 480} : undefined;
  });
  assert.deepEqual(seen, ['/src/content/posts/notes/images/cover.webp']);
  assert.equal(local.src, '/_astro/cover.hash.webp');
  const legacy = await resolve('webhid-tool-guide', {}, async () => undefined);
  assert.equal(legacy.width, 800); assert.equal(legacy.thumbnail, true);
});
test('private and demo covers never resolve; remote, traversal and invalid metadata cannot become a cover', async () => {
  let reads = 0;
  const forbidden = async () => {reads++; throw Error('should not read');};
  assert.equal(await resolve('anxiu-demo', {password: 'secret'}, forbidden), undefined);
  assert.equal(await resolve('firefly', {templateDemo: true, image: './images/firefly2.avif'}, forbidden), undefined);
  for (const image of ['https://example.com/a.jpg', '//example.com/a.jpg', '/../../secret.jpg', '../../secret.jpg', '/images/x.jpg?token=a', '/images/%2e%2e/a.jpg']) assert.equal(await resolve('new', {image}, forbidden), undefined);
  assert.equal(reads, 0);
  assert.equal(await resolve('new', {image: '/images/bad.jpg'}, async () => ({src: '/images/bad.jpg', width: 0, height: 10})), undefined);
});
