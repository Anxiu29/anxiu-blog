const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = process.env.BLOG_REPO || path.resolve(__dirname, "..");
const ts = createRequire(path.join(repo, "package.json"))("typescript");
function load(context = {}) {
	const modules = new Map();
	function read(name) {
		if (modules.has(name)) return modules.get(name);
		const file = name === "reading-resume" && process.env.READING_RESUME_SOURCE ? process.env.READING_RESUME_SOURCE : path.join(repo, "src/scripts", name + ".ts");
		assert.ok(fs.existsSync(file), "reading resume controller must exist");
		const exports = {};
		modules.set(name, exports);
		vm.runInNewContext(
			ts.transpileModule(fs.readFileSync(file, "utf8"), {
				compilerOptions: { target: 99, module: 1 },
			}).outputText,
			{ exports, require: (id) => read(id.replace("./", "")), ...context },
		);
		return exports;
	}
	return read("reading-resume");
}
const now = 1800000000000;
test("saved progress rejects corrupt, expired, future and completed records", () => {
	const { parseReadingPosition } = load();
	assert.equal(
		parseReadingPosition(
			JSON.stringify({ v: 1, percent: 42, updated: now }),
			now,
		).percent,
		42,
	);
	for (const raw of [
		null,
		"bad",
		JSON.stringify({ v: 2, percent: 42, updated: now }),
		JSON.stringify({ v: 1, percent: 99, updated: now }),
		JSON.stringify({ v: 1, percent: 4, updated: now }),
		JSON.stringify({ v: 1, percent: 42.4, updated: now }),
		JSON.stringify({ v: 1, percent: 42, updated: now + 120000 }),
		JSON.stringify({ v: 1, percent: 42, updated: now - 91 * 86400000 }),
		"x".repeat(513),
	])
		assert.equal(parseReadingPosition(raw, now), undefined);
});
test("resume geometry keeps the same progress for both long and viewport-fitting articles", () => {
	const { getReadingResumeTop } = load();
	assert.equal(
		getReadingResumeTop({ top: 600, height: 1700 }, 800, 100, 50, 0),
		1000,
	);
	assert.equal(
		getReadingResumeTop({ top: 900, height: 300 }, 800, 100, 50, 0),
		250,
	);
	assert.equal(
		getReadingResumeTop({ top: -400, height: 1700 }, 800, 100, 50, 1000),
		1000,
	);
	assert.equal(
		getReadingResumeTop({ top: 0, height: 100 }, 800, 100, 10, 0),
		0,
	);
});
function fixture({
	saved,
	blocked = false,
	hash = "",
	rootMissing = false,
} = {}) {
	const handlers = new Map();
	const timers = new Map();
	let timerId = 0;
	const storage = new Map();
	const key = "anxiu-reading-position-v1:/posts/example/";
	if (saved)
		storage.set(key, JSON.stringify({ v: 1, percent: saved, updated: now }));
	storage.set("anxiu-theme", "dark");
	const calls = [];
	const element = () => ({
		hidden: true,
		textContent: "",
		listeners: new Map(),
		addEventListener(type, fn) {
			this.listeners.set(type, fn);
		},
		emit(type) {
			this.listeners.get(type)?.();
		},
		focus() {
			calls.push("focus");
		},
	});
	const root = element(),
		resume = element(),
		clear = element(),
		label = element();
	root.querySelector = (s) =>
		({
			"[data-resume-continue]": resume,
			"[data-resume-clear]": clear,
			"[data-resume-percent]": label,
		})[s] || null;
	const body = element();
	body.getBoundingClientRect = () => body.rect;
	body.rect = { top: 600, height: 1700 };
	const win = {
		innerHeight: 800,
		scrollY: 0,
		addEventListener(type, fn) {
			handlers.set(type, fn);
		},
		removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
		scrollTo(value) {
			calls.push(value);
		},
	};
	const doc = {
		documentElement: {},
		hidden: false,
		querySelector: (s) =>
			s === "[data-reading-resume]"
				? rootMissing
					? null
					: root
				: s === ".article-body"
					? body
					: null,
		addEventListener(type, fn) {
			handlers.set(type, fn);
		},
		removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
	};
	const api = load({
		document: doc,
		window: win,
		location: { pathname: "/posts/example/", hash },
		localStorage: {
			getItem(k) {
				if (blocked) throw Error("blocked");
				return storage.get(k) || null;
			},
			setItem(k, v) {
				if (blocked) throw Error("blocked");
				storage.set(k, v);
			},
			removeItem(k) {
				if (blocked) throw Error("blocked");
				storage.delete(k);
			},
		},
		Date: { now: () => now },
		getComputedStyle: () => ({ scrollPaddingTop: "100px" }),
		setTimeout(fn) {
			timers.set(++timerId, fn);
			return timerId;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
	});
	function flush() {
		const tasks = [...timers.values()];
		timers.clear();
		tasks.forEach((fn) => fn());
	}
	return {
		api,
		root,
		resume,
		clear,
		label,
		body,
		storage,
		key,
		calls,
		handlers,
		flush,
		emit(type) {
			handlers.get(type)?.();
		},
	};
}
test("opening an article offers a choice without scrolling or overwriting the old position", () => {
	const f = fixture({ saved: 42 });
	f.api.initializeReadingResume();
	f.api.initializeReadingResume();
	assert.equal(f.root.hidden, false);
	assert.equal(f.label.textContent, "42%");
	assert.equal(f.calls.length, 0);
	f.emit("pagehide");
	assert.equal(JSON.parse(f.storage.get(f.key)).percent, 42);
	f.resume.emit("click");
	assert.equal(f.root.hidden, true);
	assert.equal(f.calls[1].behavior, "instant");
	assert.equal(f.calls[1].top, 920);
	assert.equal(f.calls[0], "focus");
});
test("scroll saves only meaningful progress and finishing removes only this article record", () => {
	const f = fixture({ saved: 42 });
	f.api.initializeReadingResume();
	f.body.rect = { top: -400, height: 1700 };
	f.emit("scroll");
	f.flush();
	assert.equal(JSON.parse(f.storage.get(f.key)).percent, 50);
	f.body.rect = { top: 900, height: 1700 };
	f.emit("scroll");
	f.flush();
	assert.equal(JSON.parse(f.storage.get(f.key)).percent, 50);
	f.body.rect = { top: -900, height: 1700 };
	f.emit("scroll");
	f.emit("pagehide");
	assert.equal(f.storage.has(f.key), false);
	assert.equal(f.storage.get("anxiu-theme"), "dark");
});
test("resume measures the body after collapsing its own prompt so it does not overshoot", () => {
	const f = fixture({ saved: 42 });
	f.body.getBoundingClientRect = () => ({
		top: f.root.hidden ? 450 : 600,
		height: 1700,
	});
	f.api.initializeReadingResume();
	f.resume.emit("click");
	assert.equal(f.calls.find((call) => typeof call === "object").top, 770);
});
test("clearing cancels pending writes, leaves preferences alone, and permits a later reading session", () => {
	const f = fixture({ saved: 42 });
	f.api.initializeReadingResume();
	f.body.rect = { top: -400, height: 1700 };
	f.emit("scroll");
	f.clear.emit("click");
	f.flush();
	f.emit("pagehide");
	assert.equal(f.storage.has(f.key), false);
	assert.equal(f.root.hidden, true);
	assert.equal(f.storage.get("anxiu-theme"), "dark");
	f.emit("scroll");
	f.flush();
	assert.equal(JSON.parse(f.storage.get(f.key)).percent, 50);
});
test("explicit fragments suppress the prompt; unavailable storage and absent public controls are safe", () => {
	const deep = fixture({ saved: 42, hash: "#section" });
	deep.api.initializeReadingResume();
	assert.equal(deep.root.hidden, true);
	assert.equal(deep.calls.length, 0);
	const denied = fixture({ blocked: true });
	assert.doesNotThrow(() => {
		denied.api.initializeReadingResume();
		denied.emit("scroll");
		denied.flush();
		denied.emit("pagehide");
	});
	assert.equal(denied.root.hidden, true);
	const privatePage = fixture({ rootMissing: true });
	privatePage.api.initializeReadingResume();
	assert.equal(privatePage.handlers.size, 0);
});

test('page swap saves pending progress and detaches old scroll handlers',()=>{
 const f=fixture({saved:42});f.api.initializeReadingResume();f.body.rect={top:-400,height:1700};f.emit('scroll');f.emit('astro:before-swap');
 assert.equal(JSON.parse(f.storage.get(f.key)).percent,50);
 assert.equal(f.handlers.has('scroll'),false);assert.equal(f.handlers.has('pagehide'),false);
 f.body.rect={top:-700,height:1700};f.flush();assert.equal(JSON.parse(f.storage.get(f.key)).percent,50);
});
