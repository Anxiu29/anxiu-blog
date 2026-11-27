const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
	require("node:path").join(__dirname, "../src/scripts/journal-music.ts"),
	"utf8",
);
const compiled = ts.transpileModule(source, {
	compilerOptions: {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.CommonJS,
	},
}).outputText;

class Element {
	constructor(tag = "div") {
		this.localName = tag;
		this.tagName = tag.toUpperCase();
		this.handlers = {};
		this.attrs = {};
		this.dataset = {};
		this.children = {};
		this.textContent = "";
		this.hidden = false;
		this.value = "";
		this.open = false;
		this.classes = new Set();
		this.classList = {
			toggle: (name, on) =>
				on ? this.classes.add(name) : this.classes.delete(name),
		};
	}
	replaceWith(node) { this.localName = node.localName; this.tagName = node.tagName; this.textContent = node.textContent; }
	addEventListener(name, fn) {
		(this.handlers[name] ??= []).push(fn);
	}
	removeEventListener(name, fn) { this.handlers[name] = (this.handlers[name] || []).filter(handler => handler !== fn); }
	emit(name, extra = {}) {
		for (const fn of this.handlers[name] || []) fn({ type: name, target: this, preventDefault() {}, ...extra });
	}
	setAttribute(name, value) {
		this.attrs[name] = String(value);
	}
	getAttribute(name) {
		return this.attrs[name] ?? null;
	}
	removeAttribute(name) {
		delete this.attrs[name];
	}
	append(...nodes) { (this.items ??= []).push(...nodes); }
	replaceChildren(...nodes) { this.items = nodes; }
	closest(selector) { return (selector === "[data-music-track]" && this.dataset.musicTrack !== undefined) || (selector === "[data-lyric-index]" && this.dataset.lyricIndex !== undefined) ? this : null; }
	querySelector(name) {
		return (this.children[name] ??= new Element());
	}
	showPopover() { this.open = true; }
	hidePopover() { this.open = false; }
	matches() {
		return this.open;
	}
	scrollIntoView() {
		this.scrolled = true;
	}
	focus() {
		this.focused = true;
	}
}
class Audio extends Element {
	constructor() {
		super();
		this.paused = true;
		this.ended = false;
		this.error = null;
		this.readyState = 0;
		this.currentTime = 0;
		this.duration = NaN;
		this.volume = 0.35;
		this.muted = false;
		this.playCalls = 0;
	}
	set src(value) {
		this.setAttribute("src", value);
	}
	get src() {
		return this.getAttribute("src") || "";
	}
	load() {
		this.readyState = 0;
		this.duration = NaN;
		this.currentTime = 0;
		this.error = null;
	}
	play() {
		++this.playCalls;
		if (this.customPlay) return this.customPlay();
		this.paused = false;
		this.readyState = 4;
		this.duration = 240;
		this.emit("loadedmetadata");
		this.emit("playing");
		return Promise.resolve();
	}
	pause() {
		const changed = !this.paused;
		this.paused = true;
		if (changed) this.emit("pause");
	}
}
function setup(saved, blocked = false, page = false, trackOverrides, autoPlay = false, customPlay) {
	const nodes = {};
	const get = (key) => (nodes[key] ??= new Element());
	const audio = (nodes["#journal-audio"] = new Audio());
	if (customPlay) audio.customPlay = customPlay;
	get("#music-config").dataset.autoPlay = String(autoPlay);
	const panel = get("#music-panel");
	if (page) panel.dataset.mode = "page";
	get("#music-config").dataset.tracks = JSON.stringify(trackOverrides || [
		{ title: "A", artist: "Artist A", url: "https://example.com/a.mp3", lrc:"[00:00]A line\n[00:03]Next A" },
		{ title: "B", artist: "Artist B", url: "https://example.com/b.mp3", lrc:"[00:00]B line\n[00:03]Next B" },
	]);
	get("#music-online-form").hidden = true;
	const rows = [new Element(), new Element()];
	rows.forEach((r, i) => (r.dataset.musicTrack = String(i)));
	let stored =
		saved === undefined
			? null
			: typeof saved === "string"
				? saved
				: JSON.stringify(saved);
	const window = new Element();
	const timers = new Set();
	const helperContext = { exports: {}, URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, fetch: (...args) => ctx.fetch(...args) };
	vm.runInNewContext(ts.transpileModule(fs.readFileSync(require("node:path").join(__dirname, "../src/scripts/music-sources.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, helperContext);
	const ctx = {
		require: () => helperContext.exports,
		AbortController,
		URL,
		fetch: async () => { throw Error("No unexpected external request"); },
		exports: {},
		document: { body: { dataset: { musicPage: String(page) } }, createElement: (tag) => new Element(tag), querySelector: get, querySelectorAll: () => rows },
		navigator: {},
		window,
		console,
		Date,
		DOMException,
		sessionStorage: {
			getItem() {
				if (blocked) throw Error("blocked");
				return stored;
			},
			setItem(_key, value) {
				if (blocked) throw Error("blocked");
				stored = value;
			},
		},
		setTimeout: (fn) => {
			timers.add(fn);
			return fn;
		},
		clearTimeout: (id) => timers.delete(id),
	};
	vm.runInNewContext(compiled, ctx);
	ctx.exports.initializeJournalMusic();
	return {
		get,
		audio,
		panel,
		rows,
		window,
		timers,
		setFetch: (fn) => { ctx.fetch = fn; },
		saved: () => JSON.parse(stored),
		init: ctx.exports.initializeJournalMusic,
		changePage: (page) => { ctx.document.body.dataset.musicPage = String(page); ctx.exports.initializeJournalMusic(); },
	};
}
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
(async () => {
	{
		const s = setup({ index: 1, time: 53 }, false, true);
		assert.equal(s.audio.playCalls, 0);
		assert.equal(s.audio.src, "");
		s.get("#open-music").emit("click");
		assert.equal(s.panel.scrolled, true);
		assert.equal(s.get("[data-music-toggle]").focused, true);
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.currentTime, 53);
		assert.equal(s.audio.paused, false);
		assert.match(s.get("[data-music-status]").textContent, /浏览博客/);
		s.audio.currentTime = 87;
		s.get("[data-music-toggle]").focused = false;
		s.get("[data-music-stop]").emit("click");
		assert.equal(s.audio.paused, true);
		assert.equal(s.audio.src, "");
		assert.equal(s.get("[data-music-toggle]").focused, true);
		assert.equal(s.saved().time, 87);
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.paused, false);
		assert.equal(s.audio.currentTime, 87);
	}
	console.log(
		"PASS: music page stays inline, restores progress only after click and never shows duplicate dock.",
	);
	for (const saved of [
		undefined,
		"invalid JSON",
		{ index: 99, time: -1, volume: "bad" },
	]) {
		const s = setup(saved);
		assert.equal(s.audio.src, "");
		assert.equal(s.audio.playCalls, 0);
		assert.equal(s.get("[data-music-title]").textContent, "A");
		assert.equal(s.get("#music-seek").disabled, true);
	}
	console.log(
		"PASS: autoplay opt-out keeps initialization free of media requests; invalid storage is safe.",
	);
	{
		const s = setup({
			index: 1,
			time: 53,
			volume: 0,
			repeat: true,
			muted: true,
			floatingLyrics: true,
		});
		assert.equal(s.audio.volume, 0);
		assert.equal(s.audio.muted, true);
		assert.equal(s.get("[data-music-title]").textContent, "B");
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.currentTime, 53);
		assert.equal(s.audio.paused, false);
		s.panel.open = true;
		s.panel.emit("toggle");
		s.panel.open = false;
		s.panel.emit("toggle");
		s.get("[data-music-mute]").emit("click");
		assert.equal(s.audio.muted, false);
		assert.equal(s.audio.volume, 0.35);
		s.audio.currentTime = 75;
		s.get("[data-music-stop]").emit("click");
		assert.equal(s.audio.paused, true);
		assert.equal(s.audio.src, "");
		assert.equal(s.saved().time, 75);
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.currentTime, 75);
	}
	console.log(
		"PASS: zero volume, mute, saved progress, hidden lyric surface, stop and resume.",
	);
	{
		const s = setup(undefined, true);
		s.get("[data-music-toggle]").emit("click");
		await settle();
		s.audio.currentTime = 110;
		s.get("[data-music-next]").emit("click");
		await settle();
		assert.equal(s.get("[data-music-title]").textContent, "B");
		assert.equal(s.audio.currentTime, 0);
		s.audio.emit("ended");
		await settle();
		assert.equal(s.get("[data-music-title]").textContent, "A");
		s.get("[data-music-repeat]").emit("click");
		s.audio.currentTime = 239;
		s.audio.emit("ended");
		await settle();
		assert.equal(s.get("[data-music-title]").textContent, "A");
		assert.equal(s.audio.currentTime, 0);
		s.get("#music-seek").value = "500";
		s.get("#music-seek").emit("input");
		assert.equal(s.audio.currentTime, 120);
		const count = s.audio.handlers.ended.length;
		s.init();
		assert.equal(s.audio.handlers.ended.length, count);
		s.get("[data-music-toggle]").emit("click");
		assert.equal(s.timers.size, 0);
	}
	console.log(
		"PASS: blocked storage, next/ended/repeat, seeking, single initialization, timer cleanup.",
	);
	{
		const s = setup();
		s.audio.customPlay = () =>
			Promise.reject(new DOMException("not allowed", "NotAllowedError"));
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.match(s.get("[data-music-status]").textContent, /再次点击/);
		assert.equal(
			s.get("[data-music-toggle]").getAttribute("aria-label"),
			"播放音乐",
		);
		delete s.audio.customPlay;
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.paused, false);
		s.audio.error = { code: 4 };
		s.audio.emit("error");
		assert.equal(s.get("[data-music-status]").dataset.error, "true");
		s.get("[data-music-toggle]").emit("click");
		await settle();
		assert.equal(s.audio.error, null);
	}
	console.log(
		"PASS: autoplay rejection and broken source show errors and allow retry.",
	);
	{
		const s = setup();
		let rejectOld;
		s.audio.customPlay = () =>
			new Promise((_resolve, reject) => {
				rejectOld = reject;
			});
		s.get("[data-music-toggle]").emit("click");
		delete s.audio.customPlay;
		s.get("[data-music-next]").emit("click");
		await settle();
		rejectOld(new DOMException("old source", "NotSupportedError"));
		await settle();
		assert.equal(s.get("[data-music-title]").textContent, "B");
		assert.equal(s.panel.dataset.playing, "true");
		assert.equal(s.get("[data-music-status]").dataset.error, "false");
	}
	console.log(
		"PASS: late rejection from an old song cannot replace the new song playback state.",
	);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

(async () => {
 const s = setup({floatingLyrics:false,bottomLyricsVisible:false});
 s.get('[data-music-toggle]').emit('click'); await settle();
 s.audio.currentTime = 51;
 const src = s.audio.src, calls = s.audio.playCalls;
 s.changePage(true);
 assert.equal(s.panel.dataset.mode, 'page', 'persisted player must adopt inline music-page mode');
 assert.equal(s.audio.currentTime,51); assert.equal(s.audio.src,src); assert.equal(s.audio.playCalls,calls);
 assert.equal(s.audio.paused,false);
 s.changePage(false);
 assert.equal(s.panel.dataset.mode,'popover');
 assert.equal(s.audio.handlers.playing.length,1,'navigation must not duplicate audio events');
 assert.equal(s.get('[data-music-toggle]').handlers.click.length,1);
 s.get('[data-music-toggle]').emit('click');
 s.changePage(true);s.changePage(false);
 assert.equal(s.audio.paused,true);assert.equal(s.audio.playCalls,calls,'paused music stays paused through navigation');
 console.log('PASS navigation: persistent player changes page mode without resetting or restarting audio and keeps a single set of controls.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async () => {
 const flush = async () => { for(let i=0;i<40;i++) await Promise.resolve(); };
 const s=setup({floatingLyrics:true,bottomLyricsVisible:true,bottomLyricsOptIn:true});let calls=0;
 s.setFetch(async()=>{calls++;return {ok:true,text:async()=>JSON.stringify([{title:'Online <b>song</b>',author:'Singer',url:'https://api.i-meto.com/meting/api?server=netease&type=url&id=123',lrc:'[00:01.00]First line\n[00:03.00]Second line'}])};});
 assert.equal(calls,0,'initial render must not request a remote playlist');
 s.get('[data-music-toggle]').emit('click');await flush();const oldCalls=s.audio.playCalls;
 s.get('[data-music-online]').emit('click');
 assert.equal(s.get('#music-online-form').hidden,false,'online source form opens');
 s.get('#music-playlist-input').value='123';
 s.get('#music-online-form').emit('submit');await flush();
 assert.equal(s.get('[data-music-title]').textContent,'Online <b>song</b>');
 assert.equal(s.audio.paused,true,'loading a playlist must never autoplay');assert.equal(s.audio.playCalls,oldCalls);
 assert.equal(s.get('[data-music-count]').textContent,'1 首');
 s.get('[data-music-toggle]').emit('click');await flush();
 const lyricList=s.get('[data-music-lyric-lines]');const firstLine=lyricList.items[0].items[0];
 firstLine.offsetTop=160;firstLine.offsetHeight=40;lyricList.offsetTop=500;lyricList.clientHeight=100;
 s.get('[data-music-lyrics-panel]').open=true;
 s.audio.currentTime=2;s.audio.emit('timeupdate');
 assert.equal(s.get('[data-floating-current]').textContent,'First line','bottom strip mirrors current timed lyric');
 assert.equal(s.get('[data-floating-next]').textContent,'Second line');
 assert.equal(s.get('#music-lyric-strip').hidden,false);
 assert.equal(s.get('[data-music-official]').getAttribute('href'),'https://music.163.com/#/song?id=123');
 s.get('[data-music-floating-toggle]').emit('click');
 assert.equal(lyricList.scrollTop,130,'lyric scroll uses offsets relative to the lyric list');
 lyricList.emit('click',{target:firstLine});assert.equal(s.audio.currentTime,1,'clicking a lyric seeks to its timestamp');
 assert.equal(s.get('[data-music-lyric-preview]').textContent,'First line');
 s.audio.error={code:4};s.audio.emit('error');await flush();
 assert.match(s.audio.src,/api\.injahow\.cn/,'failed Meting audio tries the configured backup');assert.equal(s.audio.paused,false);
 const oldTitle=s.get('[data-music-title]').textContent;
 s.setFetch(async()=>({ok:true,text:async()=>'[]'}));
 s.get('#music-online-form').emit('submit');await flush();
 assert.equal(s.get('[data-music-title]').textContent,oldTitle,'failed online requests retain working playlist');
 assert.equal(s.audio.paused,false,'failed requests retain playback');
 assert.equal(s.get('[data-music-source-status]').dataset.error,'true');
 s.get('#music-playlist-input').value='https://evil.test/?id=123';const prevCalls=calls;
 s.get('#music-online-form').emit('submit');await flush();assert.equal(calls,prevCalls);
 s.get('[data-music-curated]').emit('click');
 assert.equal(s.get('[data-music-title]').textContent,'A');assert.equal(s.audio.paused,true);
 // A slow response must not replace the curated choice after cancellation.
 let resolve;s.setFetch(()=>new Promise(r=>resolve=r));s.get('#music-playlist-input').value='123';
 s.get('#music-online-form').emit('submit');s.get('[data-music-curated]').emit('click');
 resolve({ok:true,text:async()=>JSON.stringify([{title:'Stale',url:'https://example.com/stale'}])});await flush();
 assert.equal(s.get('[data-music-title]').textContent,'A');
 assert.equal(s.get('[data-music-load]').disabled,false);
 console.log('PASS source UI: manual load, no autoplay, inline lyric sync, failure preserves playback, invalid input and cancelled request cannot replace the active list.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup(undefined,false,false,[{title:'A',artist:'A',url:'https://example.com/a.mp3',lrc:'https://example.com/a.lrc'},{title:'B',artist:'B',url:'https://example.com/b.mp3'}]);
 const pending=[];s.setFetch(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 s.get('[data-music-toggle]').emit('click');await flush();
 s.get('[data-music-next]').emit('click');await flush();
 s.get('[data-music-prev]').emit('click');await flush();
 pending[0].reject(new DOMException('Old request cancelled','AbortError'));await flush();
 assert.equal(s.get('[data-music-lyric-status]').textContent,'正在加载歌词…','old failure must not overwrite a newer lyric request for the same track');
 pending[1].resolve({ok:true,text:async()=>'[00:00.00]New lyrics'});await flush();
 assert.equal(s.get('[data-music-lyric-preview]').textContent,'New lyrics');
 console.log('PASS lyrics race: returning to the same track ignores a late failure from its previous request.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup({floatingLyrics:true,bottomLyricsVisible:true,bottomLyricsOptIn:true},false,false,[{title:'A',artist:'Artist',url:'https://example.com/a.mp3',lrc:'[00:00.00]Line one\n[00:03.00]Line two'}]);
 assert.equal(s.get('#music-lyric-strip').hidden,true,'initial strip does not obscure reading before play');
 s.get('[data-music-toggle]').emit('click');await flush();
 assert.equal(s.get('#music-lyric-strip').hidden,false);
 assert.equal(s.get('[data-floating-current]').textContent,'Line one');
 s.changePage(true);s.changePage(false);assert.equal(s.get('#music-lyric-strip').hidden,false);
 s.get('#music-lyric-strip').emit('click');
 assert.equal(s.get('#music-lyric-strip').hidden,true);assert.equal(s.audio.paused,false,'hiding lyrics keeps music playing');
 assert.equal(s.saved().floatingLyrics,false);
 s.get('[data-music-floating-toggle]').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,false);
 s.get('[data-music-toggle]').emit('click');assert.equal(s.audio.paused,true);
 s.get('[data-music-stop]').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,true);
 const disabled=setup({floatingLyrics:false,bottomLyricsVisible:false});disabled.get('[data-music-toggle]').emit('click');await flush();assert.equal(disabled.get('#music-lyric-strip').hidden,true);
 const online=setup(undefined,false,false,[{title:'Member song',artist:'Artist',url:'https://api.i-meto.com/meting/api?server=netease&type=url&id=123&auth=private-token'}]);
 online.get('[data-music-toggle]').emit('click');await flush();online.get('[data-music-official]').emit('click');assert.equal(online.audio.paused,true,'opening official listening pauses blog audio');
 console.log('PASS floating lyrics: no initial strip, current/next text, persistent route state, hide without pausing, restore, pause/stop, saved preference and official listening.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup({floatingLyrics:true,bottomLyricsVisible:true,bottomLyricsOptIn:true},false,true,[{title:'Blue Sky',artist:'Alice',url:'https://example.com/a.mp3',lrc:'[00:00.00]One\n[00:02.00]Two\n[00:04.00]Three'},{title:'Night',artist:'Bob',url:'https://example.com/b.mp3'}]);
 const queue=s.get('.music-track-list');assert.equal(queue.items?.length,2,'queue controller renders searchable rows at startup');
 const calls=s.audio.playCalls;
 s.get('#music-track-search').value='bob';s.get('#music-track-search').emit('input');
 assert.equal(queue.items[0].hidden,true);assert.equal(queue.items[1].hidden,false);assert.equal(s.audio.playCalls,calls);
 s.get('#music-track-search').value='missing';s.get('#music-track-search').emit('input');assert.equal(s.get('[data-music-queue-empty]').hidden,false);
 s.get('[data-music-search-clear]').emit('click');assert.equal(queue.items[0].hidden,false);assert.equal(s.get('#music-track-search').value,'');
 s.get('[data-music-toggle]').emit('click');await flush();
 s.get('[data-music-floating-toggle]').emit('click');s.get('[data-music-lyrics-panel]').open=true;const list=s.get('[data-music-lyric-lines]');list.clientHeight=100;list.items.forEach((li,i)=>{li.items[0].offsetTop=150+i*60;li.items[0].offsetHeight=40;});
 list.scrollTop=17;list.emit('wheel');s.audio.currentTime=3;s.audio.emit('timeupdate');assert.equal(list.scrollTop,17,'browsing lyrics must not snap to current playback');
 assert.equal(s.get('[data-music-lyric-follow]').hidden,false);s.get('[data-music-lyric-follow]').emit('click');assert.equal(list.scrollTop,180);assert.equal(s.get('[data-music-lyric-follow]').hidden,true);
 list.scrollTop=17;list.emit('wheel');list.emit('click',{target:list.items[1].items[0]});assert.equal(list.scrollTop,180,'clicking even the current line resumes lyric centering');assert.equal(s.get('[data-music-lyric-follow]').hidden,true);
 s.get('[data-music-floating-toggle]').emit('click');s.changePage(false);assert.equal(s.get('#music-lyric-strip').hidden,false,'restored lyrics remain the only bottom surface');
 s.get('[data-music-widget]').querySelector('[data-widget-action="open"]').emit('click');assert.equal(s.panel.open,true);
 s.panel.open=false;s.panel.emit('toggle');s.audio.error={code:4};s.audio.emit('error');
 assert.equal(s.get('[data-music-recovery]').hidden,false);assert.equal(queue.items[0].dataset.error,'true');
 s.get('[data-music-retry]').emit('click');await flush();assert.equal(s.audio.paused,false);assert.equal(s.get('[data-music-recovery]').hidden,true);assert.equal(queue.items[0].dataset.error,'false');
 console.log('PASS music experience: searchable queue preserves playback, empty/clear feedback, browsable lyrics with return, single lyric surface, open and retry recovery.');
})().catch(error=>{console.error(error);process.exitCode=1;});

{
 const s=setup();const queue=s.get('.music-track-list');const search=s.get('#music-track-search');
 queue.clientHeight=100;queue.items[0].offsetTop=300;queue.items[0].offsetHeight=60;
 const plays=s.audio.playCalls;
 search.value='Artist B';search.emit('input');assert.equal(queue.items[0].hidden,true);
 s.get('[data-music-locate]').emit('click');
 assert.equal(search.value,'');assert.equal(queue.items[0].hidden,false);assert.equal(queue.scrollTop,280);
 assert.equal(queue.items[0].items[0].focused,true);assert.equal(s.panel.scrolled,undefined,'locating a track scrolls only its queue');
 assert.equal(s.audio.playCalls,plays,'locating the current track never starts audio');
 let prevented=0;let stopped=0;
 search.value='absent';search.emit('input');
 search.emit('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(search.value,'');assert.equal(prevented,1);assert.equal(stopped,1);
 search.emit('keydown',{key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(prevented,1,'empty search leaves Escape free to dismiss the popover');
 assert.equal(s.audio.playCalls,plays);
 console.log('PASS music ease: locate clears filtering, centers and focuses only the active queue row without playing; Escape clears search before native dismissal.');
}

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup({floatingLyrics:true,bottomLyricsVisible:true,bottomLyricsOptIn:true});const online=s.get('[data-music-online]');const curated=s.get('[data-music-curated]');
 online.emit('click');assert.equal(online.getAttribute('aria-pressed'),'true','online view must look selected as soon as it is opened');assert.equal(curated.getAttribute('aria-pressed'),'false');
 assert.equal(s.get('#music-online-form').hidden,false);online.emit('click');assert.equal(s.get('#music-online-form').hidden,false,'selected source button is not an unrelated accordion toggle');
 assert.match(s.get('[data-music-active-source]').textContent,/默认/,'loaded source remains explicit before online success');
 s.get('#music-playlist-input').value='123';s.setFetch(async()=>({ok:false,status:503}));s.get('#music-online-form').emit('submit');await flush();
 assert.equal(online.getAttribute('aria-pressed'),'true');assert.match(s.get('[data-music-active-source]').textContent,/默认/);
 s.setFetch(async()=>({ok:true,text:async()=>JSON.stringify([{title:'Online',artist:'Singer',url:'https://example.com/online.mp3',lrc:'[00:00]Hello\n[00:03]World'}])}));
 s.get('#music-online-form').emit('submit');await flush();
 assert.match(s.get('[data-music-active-source]').textContent,/网易云/);assert.equal(s.get('[data-music-queue-panel]').open,true);assert.equal(s.audio.paused,true);
 const widget=s.get('[data-music-widget]');const action=name=>widget.querySelector('[data-widget-action="'+name+'"]');
 action('toggle').emit('click');await flush();assert.equal(s.audio.paused,false,'widget plays without opening the panel');assert.equal(s.panel.open,false);
 assert.equal(widget.querySelector('[data-widget-title]').textContent,'Online');assert.equal(widget.querySelector('[data-widget-current]').textContent,'Hello');
 s.get('#music-lyric-strip').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,true);assert.equal(widget.querySelector('[data-widget-lyrics]').hidden,true);assert.equal(s.get('[data-music-lyrics-panel]').hidden,false);
 s.get('[data-music-floating-toggle]').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,false);assert.equal(widget.querySelector('[data-widget-lyrics]').hidden,true);assert.equal(s.get('[data-music-lyrics-panel]').hidden,false);
 s.panel.open=true;s.panel.emit('toggle');assert.equal(s.get('#music-lyric-strip').hidden,false,'bottom lyrics stay visible while player is open');
 action('toggle').emit('click');assert.equal(s.audio.paused,true);const count=s.audio.playCalls;s.changePage(false);action('toggle').emit('click');await flush();assert.equal(s.audio.playCalls,count+1,'route updates never duplicate widget handlers');
 curated.emit('click');assert.equal(curated.getAttribute('aria-pressed'),'true');assert.equal(online.getAttribute('aria-pressed'),'false');assert.equal(s.get('#music-online-form').hidden,true);assert.match(s.get('[data-music-active-source]').textContent,/默认/);
 assert.equal(s.get('[data-music-queue-panel]').open,true,'explicitly opened queue stays open within the same mode');
 console.log('PASS requested music fixes: source view and active list stay distinct through success/failure; widget directly plays/pauses and shows lyrics, keeps independent bottom visibility, stays single-bound across routes; open panel keeps bottom lyrics.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup(undefined,false,false,[{title:'A',artist:'Artist',url:'https://example.com/a.mp3',lrc:'[00:00]A line'},{title:'B',artist:'Other',url:'https://example.com/b.mp3',lrc:'[00:00]B line'}]);
 const card=s.get('[data-music-widget]');const act=name=>card.querySelector('[data-widget-action="'+name+'"]');
 s.get('[data-music-floating-toggle]').emit('click');act('toggle').emit('click');await flush();assert.equal(s.audio.paused,false);assert.equal(s.panel.open,false);
 assert.equal(s.get('#music-lyric-strip').hidden,false,'new sessions show bottom lyrics while keeping widget lyrics');
 assert.equal(card.querySelector('[data-widget-lyrics]').hidden,true);assert.equal(card.querySelector('[data-widget-current]').textContent,'A line');
 act('next').emit('click');await flush();assert.equal(card.querySelector('[data-widget-title]').textContent,'B');assert.equal(card.querySelector('[data-widget-current]').textContent,'B line');
 act('prev').emit('click');await flush();assert.equal(card.querySelector('[data-widget-title]').textContent,'A');
 s.get('#music-lyric-strip').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,true);assert.equal(s.audio.paused,false);assert.equal(s.saved().floatingLyrics,false);assert.equal(card.querySelector('[data-widget-lyrics]').hidden,true);
 s.get('[data-music-floating-toggle]').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,false);assert.equal(s.saved().floatingLyrics,true);
 act('open').emit('click');assert.equal(s.panel.open,true);assert.equal(s.get('[data-music-queue-panel]').open,true,'widget settings action opens the actual settings without another click');assert.equal(s.get('#music-lyric-strip').hidden,false);
 console.log('PASS widget lyrics: explicitly enabled bottom lyrics and previous/next follow the single audio; visibility is independent and remembered.');
})().catch(error=>{console.error(error);process.exitCode=1;});



(async()=>{
 const legacy=setup({floatingLyrics: false,bottomLyricsVisible:true});legacy.get('[data-music-toggle]').emit('click');await settle();
 assert.equal(legacy.get('#music-lyric-strip').hidden,true,'old default-on preference cannot enable the new opt-in surface');legacy.get('[data-music-floating-toggle]').emit('click');assert.equal(legacy.get('#music-lyric-strip').hidden,false);
 legacy.get('#music-lyric-strip').emit('click');assert.equal(legacy.saved().bottomLyricsVisible,false);
 const restored=setup(legacy.saved());restored.get('[data-music-toggle]').emit('click');await settle();assert.equal(restored.get('#music-lyric-strip').hidden,true,'new explicit hide preference survives reinitialization');
 assert.equal(restored.get('[data-music-widget]').querySelector('[data-widget-lyrics]').hidden,true);
 console.log('PASS bottom visibility migration: legacy default-on is ignored; explicit opt-in and hide are remembered independently.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const s=setup();const widget=s.get('[data-music-widget]');const slider=widget.querySelector('[data-widget-seek]');const lyrics=s.get('[data-music-floating-toggle]');
 assert.equal(slider.disabled,true);assert.equal(lyrics.textContent,'显示底部歌词');
 slider.value='500';slider.emit('input');assert.equal(s.audio.currentTime,0);assert.equal(s.audio.playCalls,0,'unknown duration cannot seek or start playback');
 widget.querySelector('[data-widget-action="toggle"]').emit('click');await settle();
 assert.equal(slider.disabled,false);assert.equal(widget.querySelector('[data-widget-duration]').textContent,'4:00');
 s.audio.currentTime=60;s.audio.emit('timeupdate');assert.equal(slider.value,'250');
 s.changePage(false);s.changePage(false);assert.equal(slider.handlers.input.length,1);
 const plays=s.audio.playCalls;s.get('[data-music-toggle]').emit('click');slider.value='500';slider.emit('input');
 assert.equal(s.audio.currentTime,120);assert.equal(s.audio.paused,true);assert.equal(s.audio.playCalls,plays,'scrubbing a paused song never resumes it');
 assert.equal(s.get('#music-seek').value,'500');assert.equal(widget.querySelector('[data-widget-elapsed]').textContent,'2:00');assert.equal(s.saved().time,120);
 slider.value='1500';slider.emit('input');assert.equal(s.audio.currentTime,240);slider.value='bad';slider.emit('input');assert.equal(s.audio.currentTime,240);
 s.get('[data-music-floating-toggle]').emit('click');s.get('#music-lyric-strip').emit('click');assert.equal(lyrics.textContent,'显示底部歌词');assert.equal(widget.querySelector('[data-widget-lyrics]').hidden,true);
 console.log('PASS widget seeking: shared timeline and labels, disabled before metadata, paused seek without playback, bounded values, saved position and single binding across routes.');
})().catch(error=>{console.error(error);process.exitCode=1;});

{
 const s=setup();const image=s.get('[data-music-widget]').querySelector('[data-widget-cover]');const cover=s.get('[data-music-cover]');
 assert.equal(image.hidden,true,'widget does not request artwork on initialization');
 cover.setAttribute('src','https://example.com/album.jpg');cover.emit('load');
 assert.equal(image.getAttribute('src'),'https://example.com/album.jpg','widget mirrors successfully loaded album artwork');assert.equal(image.hidden,false);
 cover.emit('error');assert.equal(image.hidden,true,'failed artwork returns to music mark');
 assert.equal(image.getAttribute('src'),null);assert.equal(s.audio.playCalls,0,'artwork never starts audio');
 console.log('PASS compact music artwork: no initial request, loaded cover shared, failure returns to music mark without playback.');
}

(async()=>{
 const s=setup(undefined,false,false,[{title:'A',artist:'Artist',url:'https://example.com/a.mp3',lrc:'[00:00]One\n[00:03]Two'}]);
 s.get('[data-music-floating-toggle]').emit('click');s.get('[data-music-toggle]').emit('click');await settle();assert.equal(s.get('#music-lyric-strip').hidden,false);
 const calls=s.audio.playCalls;s.get('#music-lyric-strip').emit('click');assert.equal(s.get('#music-lyric-strip').hidden,true,'clicking the lyrics hides the strip');
 assert.equal(s.audio.paused,false);assert.equal(s.audio.playCalls,calls);assert.equal(s.saved().bottomLyricsVisible,false);
 s.changePage(true);assert.equal(s.get('[data-music-floating-toggle]').hidden,false);s.get('[data-music-floating-toggle]').emit('click');
 assert.equal(s.get('#music-lyric-strip').hidden,false);assert.equal(s.audio.playCalls,calls,'music-page restore preserves playback');
 s.changePage(false);assert.equal(s.get('[data-music-floating-toggle]').hidden,true,'restoration belongs to the music page');
 console.log('PASS minimal lyrics: click text to hide, no playback change, saved visibility and music-page-only restore.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const s=setup();const w=s.get('[data-music-widget]');const action=n=>w.querySelector('[data-widget-action="'+n+'"]');
 w.querySelector('[data-widget-volume]').value='61';w.querySelector('[data-widget-volume]').emit('input');assert.equal(s.audio.volume,.61);assert.equal(s.saved().volume,.61);
 action('mute').emit('click');assert.equal(s.audio.muted,true);assert.equal(action('mute').getAttribute('aria-pressed'),'true');action('mute').emit('click');assert.equal(s.audio.muted,false);
 action('repeat').emit('click');assert.equal(s.saved().repeat,true);action('repeat').emit('click');assert.equal(s.saved().shuffle,true);action('repeat').emit('click');assert.equal(s.saved().repeat,false);assert.equal(s.saved().shuffle,false);
 const calls=s.audio.playCalls;action('list').emit('click');assert.equal(w.querySelector('[data-widget-playlist]').hidden,false);assert.equal(w.querySelector('[data-widget-playlist]').items.length,2);assert.equal(s.audio.playCalls,calls,'opening list never plays');
 action('local-lyrics').emit('click');assert.equal(w.querySelector('[data-widget-lyrics]').hidden,false);assert.equal(w.querySelector('[data-widget-playlist]').hidden,true);assert.equal(s.audio.playCalls,calls,'local lyric drawer never changes playback');
 s.get('[data-music-floating-toggle]').emit('click');action('toggle').emit('click');await settle();assert.equal(s.get('#music-lyric-strip').hidden,false);action('local-lyrics').emit('click');assert.equal(w.querySelector('[data-widget-lyrics]').hidden,true);assert.equal(s.get('#music-lyric-strip').hidden,false,'local lyric control is independent of bottom lyrics');
 action('list').emit('click');const rows=w.querySelector('[data-widget-playlist]').items;rows[1].items[0].emit('click');await settle();assert.equal(s.get('[data-music-title]').textContent,'B');
 s.changePage(false);assert.equal(action('repeat').handlers.click.length,1);assert.equal(w.querySelector('[data-widget-volume]').handlers.input.length,1);
 console.log('PASS copied widget controls: shared volume/mute, three playback modes, independent lyric/list drawers, inline track selection and single bindings.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const s=setup(undefined,false,false,[{title:'Timed',artist:'Artist',url:'https://example.com/timed.mp3',lrc:'[00:00]First\n[00:10]Second\n[00:20]Third'}]);
 s.get('[data-music-toggle]').emit('click');await settle();
 const strip=s.get('#music-lyric-strip');
 s.audio.currentTime=5;s.audio.emit('timeupdate');
 assert.equal(strip.dataset.progress,'50','blue fill follows elapsed fraction of current timed line');
 assert.equal(s.get('[data-floating-current]').dataset.lyric,'First');assert.equal(s.get('[data-floating-next]').textContent,'Second');
 s.get('[data-music-toggle]').emit('click');const plays=s.audio.playCalls;
 s.audio.currentTime=12;s.audio.emit('timeupdate');assert.equal(strip.dataset.progress,'20');assert.equal(s.audio.paused,true);assert.equal(s.audio.playCalls,plays);
 s.audio.currentTime=20;s.audio.emit('timeupdate');assert.equal(strip.dataset.progress,'0','new line resets the highlight');
 s.audio.duration=NaN;s.audio.emit('durationchange');assert.equal(strip.dataset.progress,'0','unknown last-line duration cannot produce an invalid highlight');
 strip.emit('click');assert.equal(strip.hidden,true);assert.equal(s.audio.playCalls,plays);
 console.log('PASS timed bottom lyric fill: line fraction, line reset, paused seeking, unknown duration and hide without playback.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const s=setup();
 s.get('[data-music-quick-volume]').value='58';s.get('[data-music-quick-volume]').emit('input');assert.equal(s.audio.volume,.58);assert.equal(s.get('#music-volume').value,'58');
 s.get('[data-music-quick-mute]').emit('click');assert.equal(s.audio.muted,true);assert.equal(s.get('[data-music-mute]').getAttribute('aria-pressed'),'true');
 const queue=s.get('[data-music-queue-panel]');const lyrics=s.get('[data-music-lyrics-panel]');
 s.get('[data-music-queue-toggle]').emit('click');assert.equal(queue.open,true);assert.equal(s.get('[data-music-queue-toggle]').getAttribute('aria-expanded'),'true');
 s.get('[data-music-queue-toggle]').emit('click');assert.equal(queue.open,false);
 s.get('[data-music-lyrics-toggle]').emit('click');assert.equal(lyrics.open,true);assert.equal(s.get('[data-music-lyrics-toggle]').getAttribute('aria-expanded'),'true');
 assert.equal(s.audio.playCalls,0,'volume and drawer shortcuts never start music');
 s.changePage(true);assert.equal(s.get('[data-music-queue-toggle]').getAttribute('aria-expanded'),'true');s.changePage(false);assert.equal(s.get('[data-music-queue-toggle]').getAttribute('aria-expanded'),'false');
 assert.equal(s.get('[data-music-quick-volume]').handlers.input.length,1);
 console.log('PASS desktop player shortcuts: shared volume/mute, drawers without autoplay and correct route state.');
})().catch(error=>{console.error(error);process.exitCode=1;});

(async()=>{
 const s=setup(undefined,false,false,undefined,true);await settle();
 assert.equal(s.audio.playCalls,1,'enabled startup attempts exactly one playback');assert.equal(s.audio.paused,false);
 s.init();s.changePage(true);assert.equal(s.audio.playCalls,1,'navigation never restarts the startup attempt');
 s.get('[data-music-toggle]').emit('click');assert.equal(s.audio.paused,true);
 s.window.emit('click',{isTrusted:true,button:0});s.changePage(false);assert.equal(s.audio.playCalls,1,'manual pause survives later gestures and navigation');
 console.log('PASS auto startup: plays once, stays single across routes and respects manual pause.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup(undefined,false,false,undefined,true,()=>Promise.reject(new DOMException('blocked','NotAllowedError')));await settle();
 assert.equal(s.audio.playCalls,1);assert.equal(s.panel.dataset.autoplay,'waiting');assert.equal(s.get('[data-music-status]').dataset.error,'false','policy blocking is not a broken track');
 s.window.emit('click',{isTrusted:false,button:0});s.window.emit('keydown',{isTrusted:true,key:'Tab'});assert.equal(s.audio.playCalls,1);
 delete s.audio.customPlay;s.window.emit('click',{isTrusted:true,button:0});await settle();
 assert.equal(s.audio.playCalls,2);assert.equal(s.audio.paused,false);assert.equal(s.panel.dataset.autoplay,'started');
 s.window.emit('keydown',{isTrusted:true,key:'Enter'});assert.equal(s.audio.playCalls,2,'successful retry removes pending listeners');
 console.log('PASS autoplay policy fallback: trusted gesture only, no false track error, one retry and cleanup after success.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup(undefined,false,false,undefined,true,()=>Promise.reject(new DOMException('blocked','NotAllowedError')));await settle();delete s.audio.customPlay;
 const button=s.get('[data-music-toggle]');button.closest=()=>button;
 s.window.emit('click',{isTrusted:true,button:0,target:button});assert.equal(s.audio.playCalls,1,'capture fallback leaves music buttons to their own actions');
 button.emit('click');await settle();assert.equal(s.audio.playCalls,2);assert.equal(s.audio.paused,false,'explicit play is not immediately toggled back to paused');
 console.log('PASS autoplay control clicks: fallback does not double-toggle explicit play.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 let rejectStartup;const s=setup(undefined,false,false,undefined,true,()=>new Promise((_,reject)=>{rejectStartup=reject;}));
 assert.equal(s.audio.playCalls,1);s.get('[data-music-toggle]').emit('click');
 rejectStartup(new DOMException('late policy response','NotAllowedError'));await settle();
 s.window.emit('click',{isTrusted:true,button:0});assert.equal(s.audio.playCalls,1);assert.equal(s.panel.dataset.autoplay,'cancelled');
 console.log('PASS autoplay race: pause before a delayed rejection cannot arm a later restart.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup(undefined,false,false,undefined,true,()=>Promise.reject(new DOMException('blocked','NotAllowedError')));await settle();
 delete s.audio.customPlay;s.window.emit('keydown',{isTrusted:true,key:'Enter',ctrlKey:true});assert.equal(s.audio.playCalls,1);
 s.window.emit('keydown',{isTrusted:true,key:'Enter'});await settle();assert.equal(s.audio.playCalls,2);assert.equal(s.audio.paused,false);
 const failed=setup(undefined,false,false,undefined,true,()=>Promise.reject(new Error('source unavailable')));await settle();
 assert.equal(failed.panel.dataset.autoplay,'failed');assert.equal(failed.get('[data-music-status]').dataset.error,'true');
 failed.window.emit('click',{isTrusted:true});assert.equal(failed.audio.playCalls,1,'network failures are not retried on arbitrary page clicks');
 console.log('PASS autoplay keyboard/network distinction: Enter retries a policy block; network errors retain explicit recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup();
 const pet=s.get('[data-music-pet]');
 const toggle=s.get('[data-pet-action="toggle"]');
 const lyrics=s.get('[data-pet-action="lyrics"]');
 assert.equal(s.get('[data-pet-lyrics]').hidden,true,'pet lyrics start hidden until explicitly enabled');
 toggle.emit('click');await settle();
 assert.equal(s.audio.paused,false,'pet plays the existing audio');
 assert.equal(pet.dataset.playing,'true');
 assert.equal(toggle.getAttribute('aria-label'),'暂停音乐');
 lyrics.emit('click');
 assert.equal(lyrics.getAttribute('aria-pressed'),'true');
 assert.equal(s.get('[data-pet-lyrics]').hidden,false);
 assert.equal(s.get('[data-pet-current]').textContent,'A line');
 assert.equal(s.get('[data-pet-next]').textContent,'Next A','pet second row previews the next timed line');
 assert.equal(s.get('[data-pet-next]').hidden,false);
 pet.emit('pointerleave');s.changePage(true);s.changePage(false);
 assert.equal(s.get('[data-pet-lyrics]').hidden,false,'leaving pet and navigating retain enabled lyrics');
 s.audio.currentTime=4;s.audio.emit('timeupdate');
 assert.equal(s.get('[data-pet-current]').textContent,'Next A','pet follows current lyric');
 assert.equal(s.get('[data-pet-next]').textContent,'');assert.equal(s.get('[data-pet-next]').hidden,true,'last lyric has no stale next row');
 s.get('[data-pet-action="next"]').emit('click');await settle();
 assert.equal(s.get('[data-pet-title]').textContent,'B');
 assert.equal(s.get('[data-pet-current]').textContent,'B line');assert.equal(s.get('[data-pet-next]').textContent,'Next B','switching tracks updates both rows');
 s.get('[data-pet-action="prev"]').emit('click');await settle();
 assert.equal(s.get('[data-pet-title]').textContent,'A');
 toggle.emit('click');assert.equal(s.audio.paused,true);
 assert.equal(s.get('[data-pet-lyrics]').hidden,false,'paused lyrics remain readable');
 lyrics.emit('click');assert.equal(s.get('[data-pet-lyrics]').hidden,true);
 assert.equal(s.saved().petLyricsVisible,false);
 const restored=setup({petLyricsVisible:true});
 assert.equal(restored.get('[data-pet-action="lyrics"]').getAttribute('aria-pressed'),'true','restore chosen lyric intent');
 assert.equal(restored.get('[data-pet-lyrics]').hidden,true,'chosen lyrics stay empty before actual lyric data exists');
 restored.init();assert.equal(restored.get('[data-pet-action="toggle"]').handlers.click.length,1);
 console.log('PASS music pet: shared transport, timed lyrics, explicit visibility, pause and route persistence.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup();s.get('[data-music-toggle]').emit('click');await settle();
 assert.equal(s.get('#music-lyric-strip').hidden,true,'bottom lyrics stay off during default playback');
 assert.equal(s.get('[data-music-floating-toggle]').getAttribute('aria-pressed'),'false');
 assert.equal(s.get('[data-pet-lyrics]').hidden,true,'pet lyrics are not enabled by playback');
 s.changePage(true);s.get('[data-music-floating-toggle]').emit('click');
 assert.equal(s.get('#music-lyric-strip').hidden,false,'music page explicitly enables retained strip');
 const restored=setup(s.saved());restored.get('[data-music-toggle]').emit('click');await settle();
 assert.equal(restored.get('#music-lyric-strip').hidden,false,'remember only the new explicit opt-in');
 console.log('PASS bottom lyrics default off: manual opt-in and route/session persistence; pet remains independent.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const s=setup({petLyricsVisible:true},false,false,[{title:'Timed',artist:'Artist',url:'https://example.com/a.mp3',lrc:'https://example.com/a.lrc'},{title:'Instrumental',artist:'Artist',url:'https://example.com/b.mp3'}]);
 assert.equal(s.get('[data-pet-current]').textContent,'','initially there is no placeholder lyric');
 assert.equal(s.get('[data-pet-lyrics]').hidden,true);
 let resolve;s.setFetch(()=>new Promise(r=>{resolve=r;}));
 s.get('[data-pet-action="toggle"]').emit('click');await flush();
 assert.equal(s.get('[data-pet-lyrics]').hidden,true,'loading lyrics stay empty');
 resolve({ok:true,text:async()=>'[00:10]First line\n[00:20]Next line'});await flush();
 assert.equal(s.get('[data-pet-current]').textContent,'');assert.equal(s.get('[data-pet-next]').textContent,'');
 assert.equal(s.get('[data-pet-lyrics]').hidden,true,'before the first timestamp no prelude placeholder is displayed');
 s.audio.currentTime=12;s.audio.emit('timeupdate');
 assert.equal(s.get('[data-pet-lyrics]').hidden,false);assert.equal(s.get('[data-pet-current]').textContent,'First line');assert.equal(s.get('[data-pet-next]').textContent,'Next line');
 s.get('[data-pet-action="next"]').emit('click');await flush();
 assert.equal(s.get('[data-pet-current]').textContent,'');assert.equal(s.get('[data-pet-next]').textContent,'');assert.equal(s.get('[data-pet-lyrics]').hidden,true,'tracks without lyrics do not display status copy or old lyrics');
 assert.equal(s.get('[data-pet-action="lyrics"]').getAttribute('aria-pressed'),'true','missing data does not turn off chosen preference');
 const failed=setup({petLyricsVisible:true},false,false,[{title:'Failed',artist:'Artist',url:'https://example.com/a.mp3',lrc:'https://example.com/a.lrc'}]);
 failed.setFetch(async()=>{throw Error('offline');});failed.get('[data-pet-action="toggle"]').emit('click');await flush();
 assert.equal(failed.get('[data-pet-lyrics]').hidden,true);assert.equal(failed.get('[data-pet-current]').textContent,'');
 console.log('PASS pet empty lyrics: no placeholders during initialization, loading, prelude, failure or lyricless tracks; actual timed rows appear without changing chosen visibility.');
})().catch(e=>{console.error(e);process.exitCode=1;});

(async()=>{
 const s=setup({index:1,time:17});
 s.window.emit('click',{isTrusted:true});s.window.emit('keydown',{key:'Enter',isTrusted:true});await settle();
 assert.equal(s.audio.playCalls,0,'no automatic playback, including arbitrary page gestures');
 const stage=s.get('[data-pet-drag-handle]');stage.emit('click');await settle();assert.equal(s.audio.paused,false,'clicking the character plays the shared audio');
 assert.equal(stage.getAttribute('aria-pressed'),'true');
 stage.emit('click');assert.equal(s.audio.paused,true,'clicking again pauses');
 const calls=s.audio.playCalls;stage.emit('click',{defaultPrevented:true});assert.equal(s.audio.playCalls,calls,'a suppressed drag click cannot play');
 stage.emit('keydown',{key:'Enter'});await settle();assert.equal(s.audio.paused,false);
 stage.emit('keydown',{key:' ',repeat:true});assert.equal(s.audio.paused,false,'held keys cannot repeatedly toggle');
 stage.emit('keydown',{key:' '});assert.equal(s.audio.paused,true);
 s.init();assert.equal(stage.handlers.click.length,1,'pet click binding is idempotent');
 console.log('PASS explicit pet activation: no startup or arbitrary gesture playback; click, Enter/Space, drag suppression and single binding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
