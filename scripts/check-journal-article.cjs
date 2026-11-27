const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = process.env.BLOG_REPO || path.resolve(__dirname, "..");
const requireRepo = createRequire(path.join(repo, "package.json"));

function fixture() {
	class Element {
		constructor(tag = "div") {
			this.tagName = tag.toUpperCase();
			this.attrs = {};
			this.dataset = {};
			this.children = [];
			this.listeners = {};
			this.parentElement = null;
			this.className = "";
			this.hidden = false;
			this.disabled = false;
			this.textContent = "";
			this.open = false;
			this.isConnected = true;
			this.currentSrc = "";
		}
		get src() {
			return this.attrs.src || "";
		}
		set src(value) {
			this.attrs.src = value;
		}
		get alt() {
			return this.attrs.alt || "";
		}
		set alt(value) {
			this.attrs.alt = value;
		}
		setAttribute(key, value) {
			this.attrs[key] = String(value);
		}
		getAttribute(key) {
			return this.attrs[key] ?? null;
		}
		removeAttribute(key) {
			delete this.attrs[key];
		}
		addEventListener(type, handler) {
			if (!this.listeners[type]) this.listeners[type] = [];
			this.listeners[type].push(handler);
		}
		emit(type, options = {}) {
			const e = {
				target: this,
				key: "",
				preventDefault() {
					this.prevented = true;
				},
				...options,
			};
			for (const handler of this.listeners[type] || []) handler(e);
			return e;
		}
		click() {
			if (!this.disabled) this.emit("click");
		}
		focus() {
			doc.activeElement = this;
		}
		append(child) {
			if (child.parentElement)
				child.parentElement.children = child.parentElement.children.filter(
					(c) => c !== child,
				);
			child.parentElement = this;
			this.children.push(child);
		}
		before(child) {
			const parent = this.parentElement;
			parent.children.splice(parent.children.indexOf(this), 0, child);
			child.parentElement = parent;
		}
		closest(selector) {
			for (let node = this; node; node = node.parentElement) {
				if (
					selector.split(",").some((part) => {
						const s = part.trim();
						if (s.startsWith("."))
							return node.className.split(" ").includes(s.slice(1));
						if (s === "[data-no-image-viewer]")
							return node.attrs["data-no-image-viewer"] !== undefined;
						return node.tagName === s.toUpperCase();
					})
				)
					return node;
			}
			return null;
		}
		querySelector(selector) {
			return this.nodes?.[selector] || null;
		}
		showModal() {
			this.open = true;
		}
		close() {
			this.open = false;
			this.emit("close");
		}
	}
	const ids = {};
	for (const [id, tag] of Object.entries({
		"article-image-viewer": "dialog",
		"article-viewer-image": "img",
		"article-viewer-caption": "figcaption",
		"article-viewer-count": "span",
		"article-viewer-prev": "button",
		"article-viewer-next": "button",
		"article-viewer-close": "button",
		"article-viewer-navigation": "nav",
		"article-viewer-error": "p",
		"article-viewer-figure": "figure",
	}))
		ids[`#${id}`] = new Element(tag);
	const column = new Element("article");
	const doc = {
		images: [],
		listeners: {},
		activeElement: null,
		querySelector: (selector) =>
			ids[selector] || (selector === ".article-column" ? column : null),
		querySelectorAll: () => doc.images,
		createElement: (tag) => new Element(tag),
		addEventListener(type, handler) {
			if (!this.listeners[type]) this.listeners[type] = [];
			this.listeners[type].push(handler);
		},
		emit(type) {
			for (const fn of this.listeners[type] || []) fn();
		},
	};
	function image(src, alt, parent = column) {
		const img = new Element("img");
		if (src) img.src = src;
		img.alt = alt;
		parent.append(img);
		doc.images.push(img);
		return img;
	}
	const first = image("/first.webp", "第一张");
	const second = image("/second.webp", "第二张");
	const link = new Element("a");
	column.append(link);
	const linked = image("/linked.webp", "链接图片", link);
	const diagram = new Element("div");
	diagram.className = "plantuml-diagram-container";
	column.append(diagram);
	const technical = image("/diagram.svg", "结构图", diagram);
	const empty = image("", "等待加载");
	const observers = [];
	class Observer {
		constructor(callback) {
			this.callback = callback;
			observers.push(this);
		}
		observe() {}
		disconnect() {}
	}
	const sourceFile = path.join(repo, "src/scripts/journal-images.ts");
	assert.ok(
		fs.existsSync(sourceFile),
		"Article image enhancement module is missing",
	);
	const code = requireRepo("typescript").transpileModule(
		fs.readFileSync(sourceFile, "utf8"),
		{ compilerOptions: { target: 99, module: 1 } },
	).outputText;
	const mod = { exports: {} };
	vm.runInNewContext(code, {
		module: mod,
		exports: mod.exports,
		document: doc,
		MutationObserver: Observer,
		console,
	});
	return {
		api: mod.exports,
		doc,
		ids,
		column,
		image,
		first,
		second,
		linked,
		technical,
		empty,
		observers,
	};
}

test("article image viewer supports ordered navigation, keyboard and focus return", () => {
	const f = fixture();
	f.api.initializeArticleImages();
	const get = (id) => f.ids[`#article-viewer-${id}`];
	const dialog = f.ids["#article-image-viewer"];
	const opener = f.first.parentElement;
	assert.equal(opener.tagName, "BUTTON");
	opener.click();
	assert.equal(dialog.open, true);
	assert.equal(get("image").src, "/first.webp");
	assert.equal(get("count").textContent, "1 / 2");
	assert.equal(get("prev").disabled, true);
	const e = dialog.emit("keydown", { key: "ArrowRight" });
	assert.equal(e.prevented, true);
	assert.equal(get("image").src, "/second.webp");
	assert.equal(get("next").disabled, true);
	assert.equal(get("count").textContent, "2 / 2");
	dialog.emit("keydown", { key: "ArrowRight" });
	assert.equal(get("count").textContent, "2 / 2");
	get("prev").click();
	assert.equal(get("caption").textContent, "第一张");
	get("close").click();
	assert.equal(dialog.open, false);
	assert.equal(get("image").getAttribute("src"), null);
	assert.equal(f.doc.activeElement, opener);
});
test("viewer preserves existing links and diagrams, handles dynamic/decrypted images once", () => {
	const f = fixture();
	f.api.initializeArticleImages();
	f.api.initializeArticleImages();
	assert.equal(f.linked.parentElement.tagName, "A");
	assert.equal(
		f.technical.parentElement.className,
		"plantuml-diagram-container",
	);
	assert.notEqual(f.empty.parentElement.tagName, "BUTTON");
	assert.equal(f.first.parentElement.listeners.click.length, 1);
	const third = f.image("/third.webp", "解锁后的图片");
	f.doc.emit("password:decrypted");
	assert.equal(third.parentElement.tagName, "BUTTON");
	third.parentElement.click();
	assert.equal(f.ids["#article-viewer-count"].textContent, "3 / 3");
	for (const observer of f.observers) observer.callback();
	assert.equal(third.parentElement.listeners.click.length, 1);
});
test("failed images show a useful message and navigation can recover", () => {
	const f = fixture();
	f.api.initializeArticleImages();
	f.first.parentElement.click();
	const preview = f.ids["#article-viewer-image"];
	const error = f.ids["#article-viewer-error"];
	preview.emit("error");
	assert.equal(preview.hidden, true);
	assert.equal(error.hidden, false);
	f.ids["#article-viewer-next"].click();
	assert.equal(preview.hidden, false);
	assert.equal(error.hidden, true);
});
test("responsive picture sources stay beside their image when enhanced", () => {
	const f = fixture();
	const picture = f.doc.createElement("picture");
	const source = f.doc.createElement("source");
	f.column.append(picture);
	picture.append(source);
	const image = f.image("/responsive.webp", "响应式图片", picture);
	f.api.initializeArticleImages();
	assert.equal(image.parentElement, picture);
	assert.equal(picture.children[0], source);
	assert.equal(picture.parentElement.tagName, "BUTTON");
});

if (process.argv.includes("--built"))
	test("built articles actually load callout and dialog styling, with valid anchors and disabled task lists", () => {
		const postcss = createRequire(requireRepo.resolve("postcss-import"))(
			"postcss",
		);
		for (const slug of [
			"site-notebook",
			"webhid-tool-guide",
			"markdown-extended",
			"code-examples",
		]) {
			const html = fs.readFileSync(
				path.join(repo, "dist/posts", slug, "index.html"),
				"utf8",
			);
			const styles = [...html.matchAll(/<link\b[^>]*>/g)]
				.map((m) => m[0])
				.filter((s) => /rel="stylesheet"/.test(s))
				.map((s) => s.match(/href="([^"]+)"/)?.[1])
				.filter((s) => s?.startsWith("/"));
			assert.ok(styles.length > 0);
			const inlineStyles = [
				...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g),
			].map((match) => match[1]);
			const css = styles
				.map((s) => fs.readFileSync(path.join(repo, "dist", s), "utf8"))
				.concat(inlineStyles)
				.join("\n");
			assert.ok(
				css.includes("--callout-note-color-light"),
				"Configured callout stylesheet must be loaded on article pages",
			);
			let dialogPosition;
			postcss.parse(css).walkRules((rule) => {
				if (
					rule.selector
						.split(",")
						.some((s) => s.trim().endsWith(".article-image-viewer"))
				)
					rule.walkDecls("position", (d) => (dialogPosition = d.value));
			});
			assert.equal(
				dialogPosition,
				"fixed",
				"Viewer must not fall back to unstyled native dialog",
			);
			const ids = new Set(
				[...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
			);
			for (const m of html.matchAll(/href="#([^"]+)"[^>]*data-toc-link/g))
				assert.ok(ids.has(decodeURIComponent(m[1])), "TOC anchor must exist");
			assert.match(html, /id="article-viewer-count"/);
			assert.match(html, /id="article-viewer-prev"/);
			if (slug === "site-notebook")
				for (const checkbox of html.matchAll(
					/<input\b[^>]*type="checkbox"[^>]*>/g,
				))
					assert.match(checkbox[0], /disabled/);
		}
	});
