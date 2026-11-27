const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve("dist");
const routes = [
	"/",
	"/2/",
	"/archive/",
	"/posts/site-notebook/",
	"/posts/webhid-tool-guide/",
	"/tools/",
	"/projects/",
	"/search/",
 "/saved/",
	"/todo/",
	"/photos/",
	"/music/",
];
let checkedLinks = 0;
for (const route of routes) {
	const file = path.join(root, route, "index.html");
	assert.ok(fs.existsSync(file), `Missing route ${route}`);
	const html = fs.readFileSync(file, "utf8");
	assert.match(
		html,
		/class="[^"]*hyde-shell/,
		`Shared shell missing: ${route}`,
	);
	assert.equal(
		[...html.matchAll(/<h1(?:\s|>)/g)].length,
		1,
		`Expected one h1: ${route}`,
	);
	assert.equal(
		[...html.matchAll(/<audio(?:\s|>)/g)].length,
		1,
		`Expected one shared audio: ${route}`,
	);
	const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
	assert.equal(ids.length, new Set(ids).size, `Duplicate IDs: ${route}`);
	for (const match of html.matchAll(/\s(?:href|src)="(\/(?!\/)[^"]*)"/g)) {
		const url = new URL(match[1].replaceAll("&amp;", "&"), "https://blog.test");
		const local = path.join(root, decodeURIComponent(url.pathname));
		assert.ok(
			fs.existsSync(local),
			`Missing target ${url.pathname} from ${route}`,
		);
		if (fs.statSync(local).isDirectory())
			assert.ok(
				fs.existsSync(path.join(local, "index.html")),
				`Directory has no index: ${url.pathname}`,
			);
		checkedLinks++;
	}
	if (route.startsWith("/posts/")) {
		assert.match(html, /class="article-guide"/);
		assert.match(html, /class="article-attribution"/);
	}
	if (route === "/todo/") {
		assert.match(html, /name="robots" content="noindex,follow"/);
		assert.match(html, /data-todo-app[^>]*data-pagefind-ignore/);
		assert.doesNotMatch(
			html,
			/验收任务|验收导入|qa-import-1/,
			"Test or local task data leaked into static output",
		);
	}
	console.log(
		`PASS ${route}: one h1, shared audio, unique IDs, local links and assets.`,
	);
}
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const second = fs.readFileSync(path.join(root, "2/index.html"), "utf8");
const postUrls = (html) =>
	[...html.matchAll(/class="post-summary">\s*<a href="([^"]+)"/g)].map(
		(m) => m[1],
	);
const firstPosts = postUrls(home);
const secondPosts = postUrls(second);
assert.equal(firstPosts.length, 6);
assert.equal(secondPosts.length, 3);
assert.equal(
	new Set([...firstPosts, ...secondPosts]).size,
	9,
	"Pagination repeats or omits a public post",
);
const data =
	home.match(/id="search-data"[^>]*data-records="([^"]*)"/)?.[1] || "";
assert.doesNotMatch(
	data,
	/encrypted-demo|draft\.md|markdown-tutorial/,
	"Private, draft or template records leaked into search",
);
console.log(
	`PASS pagination: 9 distinct public posts across 2 pages; ${checkedLinks} local links/assets checked.`,
);
