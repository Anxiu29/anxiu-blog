const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFileSync, spawn } = require("node:child_process");
const file = path.join(__dirname, "chronoframe-native.cjs");
test("manual gallery instances are detected despite Windows spelling or a relative entry", () => {
	const { isPotentialGalleryProcess } = require(file);
	assert.equal(typeof isPotentialGalleryProcess, "function");
	for (const command of [
		"node D:/相册/INDEX.MJS",
		'node "d:\\相册\\index.mjs"',
		"node .\\index.mjs",
		"node index.mjs",
		"node ../server/index.mjs",
	])
		assert.equal(isPotentialGalleryProcess(command), true, command);
	for (const command of [
		"node serve-music-preview.cjs",
		"node app.js",
		"node other-index.mjs",
		"node --version",
	])
		assert.equal(isPotentialGalleryProcess(command), false, command);
});
test("native restore rejects existing, escaping and current-data destinations", (t) => {
	assert.ok(fs.existsSync(file), "Native operator implementation is missing");
	const { resolveRestoreTarget } = require(file);
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "native-album-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const restores = path.join(home, ".state/restores");
	fs.mkdirSync(restores, { recursive: true });
	const fresh = path.join(restores, "new-copy");
	assert.equal(resolveRestoreTarget(home, fresh), fresh);
	for (const target of [
		path.join(home, ".state/data"),
		restores,
		path.join(home, "public"),
		path.join(home, "../escape"),
	])
		assert.throws(
			() => resolveRestoreTarget(home, target),
			/restore|existing|outside/i,
		);
	fs.mkdirSync(fresh);
	assert.throws(() => resolveRestoreTarget(home, fresh), /existing/i);
});
test("native runtime refuses a missing or mismatched official source commit", (t) => {
	assert.ok(fs.existsSync(file), "Native operator implementation is missing");
	const { readRuntime } = require(file);
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "native-config-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const config = {
		kind: "native",
		version: "1.3.1",
		nodeVersion: "22.23.4",
		commit: "970f21c0c8766fd5be66385a131a92260ada3ce2",
	};
	fs.writeFileSync(path.join(home, "runtime.json"), JSON.stringify(config));
	assert.throws(() => readRuntime(home), /source|commit/i);
	const source = path.join(home, "source");
	fs.mkdirSync(source, { recursive: true });
	const git = (args) =>
		execFileSync("git", ["-C", source, ...args], {
			encoding: "utf8",
			windowsHide: true,
		});
	git(["init", "-q"]);
	git([
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"-q",
		"-m",
		"fixture",
	]);
	config.commit = git(["rev-parse", "HEAD"]).trim();
	fs.writeFileSync(path.join(home, "runtime.json"), JSON.stringify(config));
	assert.deepEqual(readRuntime(home), config);
	fs.writeFileSync(
		path.join(home, "runtime.json"),
		JSON.stringify({ ...config, commit: "a".repeat(40) }),
	);
	assert.throws(() => readRuntime(home), /commit/i);
});

test("real Windows process scan refuses a relative manual index.mjs instance", {
	skip: process.platform !== "win32",
}, async (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "native-writer-"));
	fs.writeFileSync(path.join(home, "index.mjs"), "setInterval(()=>{},1000)");
	const child = spawn(process.execPath, ["./index.mjs"], {
		cwd: home,
		windowsHide: true,
		stdio: "ignore",
	});
	t.after(async () => {
		if (child.exitCode === null) {
			await new Promise((resolve) => {
				child.once("exit", resolve);
				child.kill();
			});
		}
		fs.rmSync(home, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	assert.throws(
		() =>
			execFileSync(process.execPath, [file, "check-stopped", "--home", home], {
				encoding: "utf8",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			}),
		(error) =>
			error.status === 1 && /manual gallery instance/i.test(error.stderr),
	);
});
