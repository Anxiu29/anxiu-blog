const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = process.env.BLOG_REPO || path.resolve(__dirname, "..");
const requireRepo = createRequire(path.join(repo, "package.json"));
const ts = requireRepo("typescript");
const compiled = ts.transpileModule(
	fs.readFileSync(path.join(repo, "src/scripts/journal-search.ts"), "utf8"),
	{
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
		},
	},
).outputText;
const records = [
	{
		title: "鳄梨协议",
		description: "工具入门",
		text: "设置与用法",
		url: "/title/",
		type: "文章",
	},
	{
		title: "设备实践",
		description: "调试记录",
		text: `${"前言 ".repeat(80)}**鳄梨协议**：先连接设备，再观察回包。${" 结语".repeat(100)}`,
		url: "/body/",
		type: "文章",
	},
	{
		title: "<img src=x onerror=alert(1)> a+b",
		description: "括号 [示例]",
		text: "literal a+b [示例]",
		url: "/literal/",
		type: "工具",
	},
	{
		title: "音乐角落",
		description: "独立播放",
		text: "music 播放器 歌单",
		url: "/music/",
		type: "页面",
	},
];
function fixture(
	data = records,
	fullPage = false,
	href = "https://blog.test/search/?keep=1#here",
 remote = null,
) {
	let doc;
	class Text {
		constructor(text) {
			this.textContent = text;
		}
	}
	class Element {
		constructor(tag = "div") {
			this.tagName = tag.toUpperCase();
			this.children = [];
			this.dataset = {};
			this.attrs = {};
			this.listeners = {};
			this.value = "";
			this.className = "";
			this._text = "";
			this.clicks = 0;
		}
		get textContent() {
			return (
				this._text + this.children.map((child) => child.textContent).join("")
			);
		}
		set textContent(value) {
			this._text = value;
			this.children = [];
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
		hasAttribute(name) {
			return name in this.attrs;
		}
		append(...children) {
			this.children.push(
				...children.map((child) =>
					typeof child === "string" ? new Text(child) : child,
				),
			);
		}
		replaceChildren(...children) {
			this._text = "";
			this.children = [];
			this.append(...children);
		}
		querySelector(selector) {
			return (
				this.nodes?.[selector] || this.querySelectorAll(selector)[0] || null
			);
		}
		querySelectorAll(selector) {
			const all = this.children.flatMap((child) =>
				child instanceof Element ? [child, ...child.querySelectorAll("*")] : [],
			);
			return all.filter(
				(child) => selector === "*" || child.tagName === selector.toUpperCase(),
			);
		}
		removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn); }
		addEventListener(name, handler) {
			if (!this.listeners[name]) this.listeners[name] = [];
			this.listeners[name].push(handler);
		}
		emit(name, options = {}) {
			const event = {
				target: this,
				key: "",
				preventDefault() {
					this.defaultPrevented = true;
				},
				...options,
			};
			for (const handler of this.listeners[name] || []) handler(event);
			return event;
		}
		focus() {
			doc.activeElement = this;
		}
		click() {
			this.clicks++;
			this.emit("click");
		}
	}
	const input = new Element("input");
	const results = new Element("ul");
	const status = new Element("p");
	const form = new Element("form");
 const scope = new Element("select"), retry = new Element("button");
	const root = new Element();
	if (fullPage) root.setAttribute("data-search-page", "");
	root.nodes = {
 "[data-search-kind]": scope, "[data-search-retry]": retry,
		'input[type="search"]': input,
		"[data-search-results]": results,
		"[data-search-status]": status,
		form,
	};
	const dataNode = new Element();
	dataNode.dataset.records =
		typeof data === "string" ? data : JSON.stringify(data);
	if(remote){delete dataNode.dataset.records;dataNode.dataset.source='/api/search-index.json?v=test';}
 const expanded = new Element("a");
	doc = {
		listeners: {}, addEventListener: Element.prototype.addEventListener, removeEventListener: Element.prototype.removeEventListener, emit: Element.prototype.emit,
		activeElement: null,
		querySelector: (selector) =>
			selector === "#search-data"
				? dataNode
				: selector === "[data-full-search]"
					? expanded
					: null,
		querySelectorAll: () => [root],
		createElement: (tag) => new Element(tag),
		createTextNode: (text) => new Text(text),
	};
	const location = new URL(href);
	const window = new Element();
	const context = {
		exports: {},
		document: doc,
		location,
		window,
		URL,
		URLSearchParams,
  fetch:remote, AbortController, setTimeout, clearTimeout,
		console,
		history: {
			state: { index: 7, scrollX: 0, scrollY: 90 },
            replaceState(_state, _title, url) { this.state = _state;
				location.href = new URL(url, location).href;
			},
		},
	};
	vm.runInNewContext(compiled, context);
	const init = context.exports.initializeJournalSearch;
	init();
	return {
		input,
  scope, retry,
		results,
		status,
		form,
		root,
		expanded,
		doc,
		location,
		window,
		history: context.history,
		init,
		links: () => results.querySelectorAll("a"),
		search(query, options) {
			input.value = query;
			input.emit("input", options);
		},
	};
}

test("body matches expose bounded readable context and safe literal highlights", () => {
	const s = fixture();
	s.search("鳄梨协议");
	assert.equal(s.links().length, 2);
	assert.equal(s.links()[0].href, "/title/");
	const body = s.links()[1];
	assert.ok(body.textContent.includes("先连接设备，再观察回包"));
	assert.ok(!body.textContent.includes("**"));
	assert.ok(body.textContent.length < 230);
	assert.ok(
		body
			.querySelectorAll("mark")
			.some((mark) => mark.textContent === "鳄梨协议"),
	);
	s.search("a+b");
	assert.equal(s.links().length, 1);
	assert.equal(s.links()[0].querySelectorAll("img").length, 0);
	assert.ok(
		s
			.links()[0]
			.querySelectorAll("mark")
			.some((mark) => mark.textContent === "a+b"),
	);
	s.search("[示例]");
	assert.equal(s.links().length, 1);
	s.search("鳄梨协议 回包");
	assert.equal(s.links().length, 1);
	assert.equal(s.links()[0].href, "/body/");
	s.search("MUSIC");
	assert.equal(s.links()[0].href, "/music/");
});

test("Chinese composition keeps committed results and URL until it ends", () => {
	const s = fixture(records, true);
	s.search("music");
	s.input.emit("compositionstart");
	s.search("鳄梨", { isComposing: true });
	assert.equal(s.links()[0].href, "/music/");
	assert.equal(s.location.searchParams.get("q"), "music");
	s.form.emit("submit");
	assert.equal(s.links()[0].clicks, 0);
	s.input.value = "鳄梨协议";
	s.input.emit("compositionend");
	assert.equal(s.links().length, 2);
	assert.equal(s.location.searchParams.get("q"), "鳄梨协议");
	s.search("");
	assert.equal(s.location.searchParams.has("q"), false);
	assert.equal(s.links().length, 4);
});

test("keyboard moves through ordinary links, preserves modifiers and skips composition Enter", () => {
	const s = fixture();
	s.search("鳄梨协议");
	s.input.focus();
	assert.equal(
		s.input.emit("keydown", { key: "ArrowDown" }).defaultPrevented,
		true,
	);
	assert.equal(s.doc.activeElement, s.links()[0]);
	s.links()[0].emit("keydown", { key: "End" });
	assert.equal(s.doc.activeElement, s.links()[1]);
	s.links()[1].emit("keydown", { key: "ArrowUp" });
	assert.equal(s.doc.activeElement, s.links()[0]);
	s.links()[0].emit("keydown", { key: "ArrowUp" });
	assert.equal(s.doc.activeElement, s.input);
	s.input.emit("keydown", { key: "ArrowUp" });
	assert.equal(s.doc.activeElement, s.links()[1]);
	assert.ok(
		!s.input.emit("keydown", { key: "ArrowDown", ctrlKey: true })
			.defaultPrevented,
	);
	assert.ok(!s.input.emit("keydown", { key: "Home" }).defaultPrevented);
	s.input.emit("keydown", { key: "Enter", keyCode: 229 });
	assert.equal(s.links()[0].clicks, 0);
	s.input.emit("keydown", { key: "Enter" });
	assert.equal(s.links()[0].clicks, 1);
});

test("full-page URL and popstate restore queries without losing other state", () => {
	const s = fixture(
		records,
		true,
		"https://blog.test/search/?q=music&keep=1#here",
	);
	assert.equal(s.input.value, "music");
	assert.equal(s.links()[0].href, "/music/");
	s.search("鳄梨协议");
	assert.equal(s.location.searchParams.get("keep"), "1");
	assert.equal(s.location.hash, "#here");
	s.location.search = "?q=a%2Bb&keep=1";
	s.window.emit("popstate");
	assert.equal(s.input.value, "a+b");
	assert.equal(s.links()[0].href, "/literal/");
	const popup = fixture();
	popup.search("a+b [示例]");
	assert.equal(
		popup.expanded.href,
		"/search/?q=a%2Bb+%5B%E7%A4%BA%E4%BE%8B%5D",
	);
});

test("result limits, empty states, malformed data and repeated initialization are safe", () => {
	const many = Array.from({ length: 15 }, (_, i) => ({
		...records[3],
		url: `/music-${i}/`,
	}));
	const popup = fixture(many);
	popup.search("music");
	assert.equal(popup.links().length, 12);
	assert.match(popup.status.textContent, /15.*12/);
	const page = fixture(many, true);
	page.search("music");
	assert.equal(page.links().length, 15);
	popup.search("none");
	assert.equal(popup.links().length, 0);
	assert.match(popup.status.textContent, /没有找到/);
	const count = popup.input.listeners.input.length;
	popup.init();
	assert.equal(popup.input.listeners.input.length, count);
	for (const data of ["invalid JSON", "{}"]) {
		let broken;
		assert.doesNotThrow(() => {
			broken = fixture(data);
		});
		assert.match(broken.status.textContent, /暂时不可用/);
		assert.equal(broken.links().length, 0);
	}
});

test("technical identifiers and operators remain searchable and readable", () => {
	const s = fixture([
		{
			...records[1],
			text: "配置 \u0060report_id\u0060、__init__ 和 C#；表达式 a < b && b > c，指针 *p。",
		},
	]);
	for (const query of ["report_id", "__init__", "C#", "a < b", "*p"]) {
		s.search(query);
		assert.equal(s.links().length, 1, query);
		assert.ok(s.links()[0].textContent.includes(query), query);
	}
});

if (process.argv.includes("--built")) {
	test("built search is labelled, public-only and present on both page and music dialog", () => {
		const dist = path.join(repo, "dist");
		for (const route of ["search", "music"]) {
			const html = fs.readFileSync(
				path.join(dist, route, "index.html"),
				"utf8",
			);
			assert.ok(
				html.includes('aria-describedby="site-search-status site-search-help"'),
			);
			assert.ok(html.includes("方向键选择"));
			assert.ok(!html.includes('data-records="'), 'article bodies are not embedded in every page');
			const data = JSON.parse(fs.readFileSync(path.join(repo,'dist/api/search-index.json'),'utf8'));
            assert.ok(data.some(record => record.type === '作品'), 'project records use a selectable search scope');
            assert.ok(data.every(record => ['文章','工具','作品','页面'].includes(record.type)), 'all index types match visible filters');assert.ok(data.some((record) => record.url === "/music/"));
			assert.ok(
				!data.some((record) => record.url.includes("markdown-extended")),
			);
			assert.ok(
				!data.some((record) =>
					/\/posts\/(?:encrypted-demo|draft)\//.test(record.url),
				),
			);
			if (route === "search")
				assert.ok(
					html.includes(
						'aria-describedby="page-search-status page-search-help"',
					),
				);
		}
	});
}

// Real Chromium type=search consumes its first Escape to clear text unless prevented.
test('dialog search Escape closes once with text, with zero results, and leaves IME/full-page behavior intact', () => {
  const f = fixture();
  const dialog = {open:true,closes:0,close(){this.open=false;this.closes++;}};
  f.root.closest = () => dialog;
  f.input.value = 'no-match'; f.input.emit('input');
  const escape = f.input.emit('keydown', {key:'Escape'});
  assert.equal(escape.defaultPrevented,true);
  assert.equal(dialog.open,false); assert.equal(dialog.closes,1);
  assert.equal(f.input.value,'no-match','close does not erase the query');
  dialog.open=true; f.input.emit('compositionstart');
  const composingEscape = f.input.emit('keydown',{key:'Escape',isComposing:true});
  assert.notEqual(composingEscape.defaultPrevented,true); assert.equal(dialog.open,true);
  f.input.emit('compositionend');
  const full = fixture(records,true); full.root.closest=()=>dialog;
  const fullEscape = full.input.emit('keydown',{key:'Escape'});
  assert.notEqual(fullEscape.defaultPrevented,true); assert.equal(dialog.open,true);
});

test('page swap removes the old filter history listener',()=>{
 const s = fixture(records,true);
 s.doc.emit('astro:before-swap');
 assert.equal(s.window.listeners.popstate.length,0);
});

test('search preserves the router history entry when updating query',()=>{const s=fixture(records,true);s.search('music');assert.equal(s.history.state.index,7);assert.equal(s.history.state.scrollY,90);});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('slow shared index renders the latest input and stays lazy before first use',async()=>{
 let calls=0,resolve;const remote=()=>{calls++;return new Promise(r=>resolve=r);};
 const s=fixture(records,false,undefined,remote);assert.equal(calls,0);s.search('music');assert.equal(calls,1);s.search('鳄梨协议');assert.match(s.status.textContent,/正在加载/);resolve({ok:true,json:async()=>records});await settle();
 assert.equal(calls,1);assert.equal(s.links()[0].href,'/title/');assert.ok(!s.links().some(link=>link.href==='/music/'));
});
test('failed index offers a retry that uses the current query without duplicate handlers',async()=>{
 let calls=0;const s=fixture(records,false,undefined,async()=>{calls++;return calls===1?{ok:false}:{ok:true,json:async()=>records};});
 s.search('music');await settle();assert.equal(s.retry.hidden,false);s.init();s.retry.emit('click');await settle();assert.equal(calls,2);assert.equal(s.links()[0].href,'/music/');assert.equal(s.retry.hidden,true);
});
test('search kind is combined with text and restored with query history',()=>{
 const s=fixture(records,true);s.scope.value='文章';s.scope.emit('change');s.search('music');assert.equal(s.links().length,0);assert.equal(s.location.searchParams.get('kind'),'文章');
 s.location.search='?q=music&kind=页面';s.window.emit('popstate');assert.equal(s.scope.value,'页面');assert.equal(s.links()[0].href,'/music/');
});

test('search snippets show readable steps and tasks without authoring directive syntax',()=>{
 const s=fixture([{title:'教程',description:'步骤',url:'/posts/test/',type:'文章',text:'::::steps\n:::step[连接设备]\n核对设备，观察回包。\n:::\n::::\n- [x] 保存记录'}]);s.search('回包');const text=s.links()[0].textContent;assert.ok(!text.includes(':::'));assert.ok(!text.includes('[x]'));assert.ok(text.includes('连接设备'));
});
