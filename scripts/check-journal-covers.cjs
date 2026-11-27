const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const repo = process.env.BLOG_REPO || path.resolve(__dirname, "..");
const requireRepo = createRequire(path.join(repo, "package.json"));
const ts = requireRepo("typescript");
function compile(file) {
	const filename = path.join(repo, file);
	return fs.existsSync(filename)
		? ts.transpileModule(fs.readFileSync(filename, "utf8"), {
				compilerOptions: {
					target: ts.ScriptTarget.ES2022,
					module: ts.ModuleKind.CommonJS,
				},
			}).outputText
		: "";
}
const compiled = compile("src/scripts/journal-covers.ts");
function fixture(complete = false, width = 0) {
	const image = {
		complete,
		naturalWidth: width,
		hidden: false,
		src: "/original.jpg",
		listeners: {},
		addEventListener(name, handler) {
			if (!this.listeners[name]) this.listeners[name] = [];
			this.listeners[name].push(handler);
		},
		emit(name) {
			for (const fn of this.listeners[name] || []) fn();
		},
	};
	const fallback = { hidden: true };
	const wrapper = {
		dataset: {},
		href: "/article/",
		querySelector: (selector) => (selector === "img" ? image : fallback),
	};
	const roots = [wrapper];
	const context = { exports: {}, document: { querySelectorAll: () => roots } };
	vm.runInNewContext(compiled, context);
	const init = context.exports.initializePostCovers;
	assert.equal(typeof init, "function", "cover controller must exist");
	init();
	return { image, fallback, wrapper, init, roots };
}

test("cached success and cached failure initialize without changing image URL or article link", () => {
	const good = fixture(true, 1280);
	assert.equal(good.wrapper.dataset.coverState, "ready");
	assert.equal(good.fallback.hidden, true);
	assert.equal(good.image.hidden, false);
	const bad = fixture(true, 0);
	assert.equal(bad.wrapper.dataset.coverState, "error");
	assert.equal(bad.fallback.hidden, false);
	assert.equal(bad.image.hidden, true);
	assert.equal(bad.image.src, "/original.jpg");
	assert.equal(bad.wrapper.href, "/article/");
});

test("pending lazy image does not look failed and load can recover an earlier failure", () => {
	const s = fixture();
	assert.notEqual(s.wrapper.dataset.coverState, "error");
	assert.equal(s.image.hidden, false);
	assert.equal(s.fallback.hidden, true);
	s.image.emit("error");
	assert.equal(s.image.hidden, true);
	assert.equal(s.fallback.hidden, false);
	s.image.naturalWidth = 1280;
	s.image.emit("load");
	assert.equal(s.wrapper.dataset.coverState, "ready");
	assert.equal(s.image.hidden, false);
	assert.equal(s.fallback.hidden, true);
});

test("initialization is idempotent and incomplete wrappers cannot break other cards", () => {
	const s = fixture();
	const count = s.image.listeners.error.length;
	s.roots.unshift({ querySelector: () => null });
	assert.doesNotThrow(() => {
		s.init();
		s.init();
	});
	assert.equal(s.image.listeners.error.length, count);
	assert.equal(s.image.listeners.load.length, 1);
});

test("declared real screenshot sizes match actual image dimensions", async () => {
	const context = { exports: {} };
	vm.runInNewContext(compile("src/utils/post-media.ts"), context);
	const sharp = requireRepo("sharp");
	for (const id of ["anxiu-demo", "fog-town-nightwalk", "webhid-tool-guide"]) {
		const media = await context.exports.resolvePostMedia(id, {}, async () => undefined);
		const actual = await sharp(path.join(repo, "public", media.src)).metadata();
		assert.equal(media.width, actual.width, `${id} width`);
		assert.equal(media.height, actual.height, `${id} height`);
	}
});

if (process.argv.includes("--built")) {
	test("normal cards keep dimensioned lazy covers and related cards omit hidden media", () => {
		const dist = path.join(repo, "dist");
		let covers = 0;
		for (const route of ["", "2", "archive"]) {
			const html = fs.readFileSync(
				path.join(dist, route, "index.html"),
				"utf8",
			);
			for (const match of html.matchAll(
				/<a\b[^>]*class="post-cover"[^>]*>([\s\S]*?)<\/a>/g,
			)) {
				covers++;
				assert.ok(match[0].includes("data-post-cover"));
				assert.ok(match[0].includes("data-cover-fallback"));
				assert.ok(match[0].includes("封面暂不可用"));
				const image = match[1].match(/<img\b[^>]*>/)[0];
				assert.match(image, /loading="lazy"/);
				assert.match(image, /width="\d+"/);
				assert.match(image, /height="\d+"/);
			}
		}
		assert.ok(covers >= 4);
		let related = 0;
		for (const folder of fs.readdirSync(path.join(dist, "posts"))) {
			const file = path.join(dist, "posts", folder, "index.html");
			if (!fs.existsSync(file)) continue;
			const html = fs.readFileSync(file, "utf8");
			const section = html.match(
				/<section class="related-posts"[\s\S]*?<\/section>/,
			)?.[0];
			if (!section) continue;
			related++;
			assert.ok(!section.includes('class="post-cover"'));
			assert.ok(!section.includes("has-cover"));
			assert.ok(!/<img\b/.test(section));
		}
		assert.ok(related >= 3);
	});
}
