const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = process.env.BLOG_REPO || path.resolve(__dirname, "..");
const requireRepo = createRequire(path.join(repo, "package.json"));
const compiled = requireRepo("typescript").transpileModule(
	fs.readFileSync(path.join(repo, "src/scripts/archive-filter.ts"), "utf8"),
	{ compilerOptions: { target: 9, module: 1 } },
).outputText;
function fixture(href = "https://blog.test/archive/?keep=1#list") {
	class Element {
		constructor() {
			this.listeners = {};
			this.dataset = {};
			this.attrs = {};
			this.children = [];
			this.hidden = false;
			this._value = "";
			this.textContent = "";
		}
		get value() {
			return this._value;
		}
		set value(value) {
			this._value = value;
		}
		removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn); }
		addEventListener(name, fn) {
			if (!this.listeners[name]) this.listeners[name] = [];
			this.listeners[name].push(fn);
		}
		emit(name, options = {}) {
			const event = {
				preventDefault() {
					this.defaultPrevented = true;
				},
				...options,
			};
			for (const fn of this.listeners[name] || []) fn(event);
			return event;
		}
		setAttribute(key, value) {
			this.attrs[key] = String(value);
		}
		focus() {
			this.focused = true;
		}
		append(child) {
			child.parent = this;
			this.children.push(child);
		}
		remove() {
			this.parent.children = this.parent.children.filter(
				(item) => item !== this,
			);
		}
		querySelector() {
			return (
				this.children.find(
					(item) => item.attrs["data-archive-missing"] !== undefined,
				) || null
			);
		}
	}
	class Select extends Element {
		constructor() {
			super();
			for (const value of ["", "工具", "随笔"]) {
				const option = new Element();
				option.value = value;
				this.append(option);
			}
		}
		get options() {
			return this.children;
		}
		get value() {
			return this._value;
		}
		set value(value) {
			this._value = this.children.some((option) => option.value === value)
				? value
				: "";
		}
	}
	const nodes = {};
	for (const id of [
		".archive-filter",
		"#archive-query",
		"#archive-status",
		"#archive-empty",
		"#archive-clear-tag",
	])
		nodes[id] = new Element();
	nodes["#archive-category"] = new Select();
	const rows = [
		{ filterText: "HID 工具 USB 回包", category: "工具", tags: "USB|HID" },
		{ filterText: "键位配置 USB", category: "工具", tags: "USB" },
		{ filterText: "雨夜记录", category: "随笔", tags: "日常" },
	].map((data) => {
		const row = new Element();
		row.dataset = data;
		return row;
	});
	const location = new URL(href);
	const window = new Element();
	const entries = [href];
	let cursor = 0;
	const history = {
		pushes: 0,
		replaces: 0,
		state: { retained: true },
		pushState(state, _title, url) {
			this.state = state;
			this.pushes++;
			entries.splice(++cursor);
			entries.push(new URL(url, location).href);
			location.href = entries[cursor];
		},
		replaceState(state, _title, url) {
			this.state = state;
			this.replaces++;
			entries[cursor] = new URL(url, location).href;
			location.href = entries[cursor];
		},
		back() {
			if (cursor > 0) {
				location.href = entries[--cursor];
				window.emit("popstate");
			}
		},
		forward() {
			if (cursor + 1 < entries.length) {
				location.href = entries[++cursor];
				window.emit("popstate");
			}
		},
	};
	const context = {
		exports: {},
		URL,
		URLSearchParams,
		location,
		window,
		history,
		document: {
			listeners: {}, addEventListener: Element.prototype.addEventListener, removeEventListener: Element.prototype.removeEventListener, emit: Element.prototype.emit,
			querySelector: (key) => nodes[key],
			querySelectorAll: () => rows,
			createElement: () => new Element(),
		},
	};
	vm.runInNewContext(compiled, context);
	const init = context.exports.initializeArchiveFilter;
	init();
	return {
		init,
		doc: context.document,
		rows,
		location,
		window,
		history,
		input: nodes["#archive-query"],
		category: nodes["#archive-category"],
		status: nodes["#archive-status"],
		empty: nodes["#archive-empty"],
		clear: nodes["#archive-clear-tag"],
		form: nodes[".archive-filter"],
		visible: () => rows.filter((row) => !row.hidden).length,
	};
}

test("category and tag changes have usable back/forward history without loops", () => {
	const s = fixture("https://blog.test/archive/?tag=USB&keep=1#list");
	assert.equal(s.visible(), 2);
	s.category.value = "工具";
	s.category.emit("change");
	assert.equal(s.history.pushes, 1);
	assert.equal(s.history.state?.retained, true);
	s.clear.emit("click");
	assert.equal(s.history.pushes, 2);
	assert.equal(s.clear.hidden, true);
	s.history.back();
	assert.equal(s.category.value, "工具");
	assert.equal(s.clear.hidden, false);
	s.history.back();
	assert.equal(s.category.value, "");
	assert.equal(s.visible(), 2);
	s.history.forward();
	assert.equal(s.category.value, "工具");
	assert.equal(s.history.pushes, 2);
	assert.equal(s.location.searchParams.get("keep"), "1");
	assert.equal(s.location.hash, "#list");
});

test("typing replaces only committed input and Chinese composition keeps rows and URL", () => {
	const s = fixture();
	s.input.value = "USB";
	s.input.emit("input");
	assert.equal(s.visible(), 2);
	assert.equal(s.history.pushes, 0);
	assert.equal(s.history.replaces, 1);
	assert.equal(s.history.state?.retained, true);
	s.input.emit("compositionstart");
	s.input.value = "雨";
	s.input.emit("input", { isComposing: true });
	assert.equal(s.visible(), 2);
	assert.equal(s.location.searchParams.get("q"), "USB");
	s.form.emit("submit");
	assert.equal(s.visible(), 2);
	s.input.value = "雨夜";
	s.input.emit("compositionend");
	assert.equal(s.visible(), 1);
	assert.equal(s.location.searchParams.get("q"), "雨夜");
	assert.equal(s.history.pushes, 0);
});

test("matching combines query, category and exact tag; clear tag preserves other filters", () => {
	const s = fixture(
		"https://blog.test/archive/?q=USB%20%E5%9B%9E%E5%8C%85&category=%E5%B7%A5%E5%85%B7&tag=HID",
	);
	assert.equal(s.visible(), 1);
	assert.match(s.status.textContent, /共 1 篇/);
	s.clear.emit("click");
	assert.equal(s.visible(), 1);
	assert.equal(s.category.value, "工具");
	assert.equal(s.input.focused, true);
	assert.equal(s.location.searchParams.get("q"), "USB 回包");
	s.input.value = "unmatched";
	s.input.emit("input");
	assert.equal(s.visible(), 0);
	assert.equal(s.empty.hidden, false);
	s.form.emit("reset");
	assert.equal(s.visible(), 3);
	assert.equal(s.empty.hidden, true);
	assert.equal(s.input.value, "");
	assert.equal(s.category.value, "");
	assert.equal(s.clear.hidden, true);
});

test("unknown categories stay visibly selected and fail closed, then clean up on change", () => {
	const s = fixture(
		"https://blog.test/archive/?category=%E4%B8%8D%E5%AD%98%E5%9C%A8",
	);
	assert.equal(s.visible(), 0);
	assert.equal(s.empty.hidden, false);
	assert.equal(s.category.value, "不存在");
	assert.match(s.category.options.at(-1).textContent, /失效.*不存在/);
	s.category.value = "工具";
	s.category.emit("change");
	assert.equal(s.visible(), 2);
	assert.ok(!s.category.options.some((option) => option.value === "不存在"));
	s.history.back();
	assert.equal(s.category.value, "不存在");
	assert.equal(s.visible(), 0);
});

test("no-op and repeated initialization do not duplicate history or event handlers", () => {
	const s = fixture();
	const count = s.input.listeners.input.length;
	s.init();
	assert.equal(s.input.listeners.input.length, count);
	s.category.emit("change");
	s.form.emit("reset");
	assert.equal(s.history.pushes, 0);
	assert.equal(s.history.replaces, 0);
});

test("unchanged filters do not create history just to reorder query parameters", () => {
	const s = fixture(
		"https://blog.test/archive/?category=%E5%B7%A5%E5%85%B7&keep=1&tag=USB#list",
	);
	s.form.emit("submit");
	assert.equal(s.history.pushes, 0);
	assert.equal(s.history.replaces, 0);
	assert.equal(s.location.searchParams.get("keep"), "1");
});

if (process.argv.includes("--built"))
	test("built archive links and summary styles are wired in the active layout", () => {
		const dist = path.join(repo, "dist");
		const html = fs.readFileSync(path.join(dist, "archive/index.html"), "utf8");
		assert.ok(html.includes('aria-describedby="archive-status"'));
		const sheets = [...html.matchAll(/<link\b[^>]*href="([^"?#]+\.css)"/g)].map(
			(match) => fs.readFileSync(path.join(dist, match[1]), "utf8"),
		);
		const css = [
			...sheets,
			...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
				(match) => match[1],
			),
		].join("\n");
		assert.match(css, /\.archive-filter-summary\s*\{/);
		assert.match(css, /#archive-clear-tag\s*\{/);
		for (const route of ["categories", "tags"]) {
			const page = fs.readFileSync(
				path.join(dist, route, "index.html"),
				"utf8",
			);
			assert.ok(
				page.includes(`/archive/?${route === "tags" ? "tag" : "category"}=`),
			);
		}
	});

test('page swap removes the old filter history listener',()=>{
 const s = fixture();
 s.doc.emit('astro:before-swap');
 assert.equal(s.window.listeners.popstate.length,0);
});
