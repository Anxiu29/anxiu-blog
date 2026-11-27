import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import directive from "remark-directive";
import sectionize from "remark-sectionize";
import callouts from "rehype-callouts";
import { parseDirectiveNode } from "../src/plugins/remark-directive-rehype.js";

const fixture = new URL("../tests/authoring/primitives.md", import.meta.url);
const source = fs.readFileSync(fixture, "utf8");
const remarkPlugins = [directive, sectionize, parseDirectiveNode];
const processor = await createMarkdownProcessor({ remarkPlugins, rehypePlugins: [callouts], syntaxHighlight: false });
const html = (await processor.render(source, { fileURL: fixture })).code;
assert.match(html, /<ol[^>]*class="authoring-steps"/);
assert.equal((html.match(/<li class="authoring-step"/g) || []).length, 2);
assert.match(html, /data-authoring-tabs="code"/);
assert.match(html, /data-authoring-tabs="content"/);
assert.match(html, /data-label="Windows"/);
assert.match(html, /<code class="language-sh">pnpm install\n<\/code>/);
assert.match(html, /callout/);
assert.doesNotMatch(html, /<\/?(?:steps|step|tabs|tab|codegroup)(?:\s|>)/);

for (const invalid of [":::tab[orphan]\ntext\n:::", ":::tabs\ntext\n:::", "::::tabs\n:::tab\ntext\n:::\n::::", "::::codegroup\n:::tab[empty]\ntext\n:::\n::::"]) {
  await assert.rejects(processor.render(invalid, { fileURL: fixture }), /authoring|Authoring/);
}

// Compile the same fixture through the installed MDX integration, not a parallel parser.
const require = createRequire(import.meta.url);
const mdxDir = fileURLToPath(new URL("./", pathToFileURL(require.resolve("@astrojs/mdx"))));
const { createMdxProcessor } = await import(pathToFileURL(`${mdxDir}plugins.js`).href);
const mdx = createMdxProcessor({ remarkPlugins, rehypePlugins: [callouts], recmaPlugins: [], syntaxHighlight: false, gfm: true, smartypants: false, remarkRehype: {} }, {});
const compiled = await mdx.process({ value: source, path: fileURLToPath(new URL("../tests/authoring/primitives.mdx", import.meta.url)), data: { astro: { frontmatter: {} }, applyFrontmatterExport: { srcDir: new URL("../src/", import.meta.url) } } });
assert.match(String(compiled), /authoring-steps/);
assert.match(String(compiled), /data-authoring-tabs/);
console.log("Authoring fixture: Markdown and MDX steps, nested callout tabs, code groups, and invalid syntax checks passed.");
