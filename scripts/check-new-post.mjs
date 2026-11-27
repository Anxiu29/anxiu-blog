import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./new-post.js", import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "blog-new-post-"));
const root = path.join(temp, "site");
const posts = path.join(root, "src/content/posts");
fs.mkdirSync(posts, { recursive: true });
const run = (args, cwd = root) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
try {
  for (const invalid of ["../escape", "a/../../escape", "C:\\escape", "/escape", "a: b", "a\nother", "CON", "folder./x", "trailing "]) {
    const result = run([invalid]);
    assert.notEqual(result.status, 0, `unsafe filename accepted: ${JSON.stringify(invalid)}`);
  }
  assert.notEqual(run(["wrong-place"], temp).status, 0, "wrong cwd must fail before creating directories");
  assert.equal(fs.existsSync(path.join(temp, "src")), false);
  assert.notEqual(run(["bad-date", "--date", "2026-02-30"]).status, 0);
  assert.equal(fs.existsSync(path.join(posts, "bad-date.md")), false);
  const result = run(["guides/first.mdx", "--title", "Title: # quoted", "--date", "2026-11-25", "--tags", "Astro,中文"]);
  assert.equal(result.status, 0, result.stderr);
  const filename = path.join(posts, "guides/first.mdx");
  const content = fs.readFileSync(filename, "utf8");
  assert.match(content, /title: "Title: # quoted"/);
  assert.match(content, /published: 2026-11-25/);
  assert.match(content, /draft: true/);
  assert.match(content, /tags: \["Astro","中文"\]/);
  assert.notEqual(run(["guides/first.mdx"]).status, 0);
  assert.equal(fs.readFileSync(filename, "utf8"), content, "existing file was overwritten");
  assert.notEqual(run(["guides/first.md"]).status, 0, "same slug with other extension must fail");
  // Junctions on Windows do not require developer mode or symbolic-link privileges.
  const outside = path.join(temp, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(posts, "redirect"), process.platform === "win32" ? "junction" : "dir");
  assert.notEqual(run(["redirect/escape"]).status, 0);
  assert.equal(fs.existsSync(path.join(outside, "escape.md")), false);
  console.log("Author CLI: unsafe paths, cwd, dates, YAML quoting, drafts, collisions, and junction escape checks passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
