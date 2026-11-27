const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const html = fs.readFileSync(path.join(root, "music/index.html"), "utf8");
assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
assert.equal([...html.matchAll(/<audio\b/g)].length, 1);
const audio = html.match(/<audio\b[^>]*>/)[0];
assert.ok(audio.includes('preload="none"'));
assert.ok(!/\s(?:src|autoplay)(?:=|[\s>])/.test(audio));
const panel = html.match(/<section\b[^>]*id="music-panel"[^>]*>/)[0];
assert.ok(panel.includes('data-mode="page"'));
assert.ok(!panel.includes("popover="));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(ids.length, new Set(ids).size);
const readingLink = [...html.matchAll(/<a\b[^>]*>/g)]
	.map((m) => m[0])
	.find((s) => s.includes("music-read-link"));
assert.ok(!readingLink.includes('target="_blank"'));
assert.ok(html.includes("同一标签页切换文章"));
assert.ok(html.includes("进入独立工具页面会停止"));
assert.ok(html.includes('data-astro-transition-persist="journal-player"'));
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(home.includes('href="/music/"'));
assert.ok(home.includes('data-mode="popover"'));
for (const ref of [...html.matchAll(/\s(?:href|src)="(\/(?!\/)[^"]+)"/g)].map(
	(m) => m[1],
)) {
	const url = new URL(ref.replaceAll("&amp;", "&"), "https://blog.test");
	assert.ok(
		fs.existsSync(path.join(root, decodeURIComponent(url.pathname))),
		"Missing music page asset/link",
	);
}
console.log(
	"PASS: music page has one JS-controlled inline player, unique IDs, same-tab continuous reading and working links; home keeps popover mode.",
);

const queueAttrs=html.match(/<details\b[^>]*data-music-queue-panel[^>]*>/)[0];
const homeQueue=home.match(/<details\b[^>]*data-music-queue-panel[^>]*>/)[0];
assert.match(queueAttrs,/\sopen(?:[=\s>])/,'dedicated music page opens its queue');
assert.doesNotMatch(homeQueue,/\sopen(?:[=\s>])/,'popover queue starts folded for compact controls');
assert.ok(home.includes('data-music-active-source'));
assert.ok(home.includes('data-music-widget'));
for(const action of ['toggle','prev','next','open']) assert.ok(home.includes('data-widget-action="'+action+'"'),'real widget action: '+action);
assert.ok(home.includes('data-widget-current'));assert.ok(home.includes('data-widget-next'));
console.log('PASS requested music markup: compact popover queue, visible page queue, distinct active source and real widget playback/lyric controls.');

assert.ok(!home.includes('data-music-member-connect'));
assert.ok(!home.includes('127.0.0.1:4334'));
const playerHtml=home.slice(home.indexOf('id="journal-player"'),home.indexOf('id="music-config"'));
assert.ok(!playerHtml.includes('/branding/clover.svg'),'music decorations use music icons');
const widgetHtml=home.match(/<section[^>]*data-music-widget[\s\S]*?<\/section>/)[0];
assert.ok(!widgetHtml.includes('/branding/clover.svg'),'widget music mark is independent of site branding');
console.log('PASS music appearance structure: no local-account entry and generic music icons.');

assert.ok(!home.includes('data-widget-action="lyrics"'));
assert.ok(!home.includes('class="music-widget-actions"'));
assert.ok(/<h2[^>]*><button[^>]+data-widget-action="open"/.test(home));
assert.ok(!home.includes('id="music-dock"'));
const strip=home.match(/<button[^>]+id="music-lyric-strip"[^>]*>([\s\S]*?)<\/button>/)[1];
assert.ok(strip.includes('data-floating-current'));assert.ok(strip.includes('data-floating-next'));
assert.ok(home.includes('https://music.163.com/playlist?id=18638530828'));
assert.ok(home.includes('又活了一天'));assert.ok(!home.includes('uct2='));
console.log('PASS minimal markup: heading opens settings, no widget footer/mini-player, lyric-only clickable surface and requested default playlist.');

for (const page of [home,html]) assert.match(page, /id="music-config"[^>]*data-auto-play="false"/, "blog and music page wait for explicit playback");

for(const page of [home,html]) {
 assert.equal([...page.matchAll(/data-music-pet(?:[ =>])/g)].length,1,'one persistent pet per blog page');
 for(const action of ['prev','toggle','next','lyrics']) assert.ok(page.includes('data-pet-action="'+action+'"'));
 assert.ok(!page.includes('data-pet-action="like"'));
 assert.ok(page.includes('id="pet-lyric-line"'));
}
console.log('PASS music pet markup: one pet, shared transport, lyric toggle and no like control.');
