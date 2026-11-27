const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const backupModule = path.join(__dirname, "chronoframe-backup.cjs");
const entryModule = path.join(__dirname, "../src/data/chronoframe.ts");
const RUNTIME = {
	kind: "native",
	version: "1.3.1",
	commit: "970f21c0c8766fd5be66385a131a92260ada3ce2",
	nodeVersion: "22.23.4",
};
const api = () => {
	assert.ok(fs.existsSync(backupModule), "Backup implementation missing");
	return require(backupModule);
};
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "chronoframe-test-"));
	t.after(() => {
		assert.ok(
			path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});
	const dataDir = path.join(root, "私人 照片");
	fs.mkdirSync(path.join(dataDir, "storage"), { recursive: true });
	fs.writeFileSync(
		path.join(dataDir, "app.sqlite3"),
		Buffer.from([0, 1, 2, 255]),
	);
	fs.writeFileSync(
		path.join(dataDir, ".session-password"),
		"synthetic-session",
	);
	fs.writeFileSync(path.join(dataDir, ".app-secret"), "synthetic-secret");
	fs.writeFileSync(
		path.join(dataDir, "storage/旅行 一.jpg"),
		Buffer.from([255, 216, 0, 10, 255]),
	);
	const configFile = path.join(root, "runtime.json");
	fs.writeFileSync(configFile, JSON.stringify(RUNTIME));
	return {
		root,
		dataDir,
		configFile,
		backupRoot: path.join(root, "备份"),
		runtime: RUNTIME,
	};
}
test("backup implementation exists before data tests", () => {
	api();
});
test("complete snapshot roundtrip includes hidden keys, Unicode filenames and exact bytes", (t) => {
	const a = api();
	const f = fixture(t);
	const b = a.createBackup(f);
	const m = a.verifyBackup(b);
	assert.equal(m.version, 2);
	assert.deepEqual(m.runtime, RUNTIME);
	const targetDir = path.join(f.root, "恢复 新目录");
	a.restoreBackup({ backupDir: b, targetDir });
	for (const name of [
		"app.sqlite3",
		".session-password",
		".app-secret",
		"storage/旅行 一.jpg",
	])
		assert.deepEqual(
			fs.readFileSync(path.join(targetDir, name)),
			fs.readFileSync(path.join(f.dataDir, name)),
		);
	assert.deepEqual(
		fs.readFileSync(path.join(b, "runtime.json")),
		fs.readFileSync(f.configFile),
	);
	assert.notEqual(a.createBackup(f), b);
});
test("restore never overwrites existing directory or current data", (t) => {
	const a = api();
	const f = fixture(t);
	const b = a.createBackup(f);
	assert.throws(
		() => a.restoreBackup({ backupDir: b, targetDir: f.dataDir }),
		/exist|存在/i,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(f.dataDir, "app.sqlite3")),
		Buffer.from([0, 1, 2, 255]),
	);
});
test("modified, missing and extra files reject restoration before creating target", (t) => {
	const a = api();
	const f = fixture(t);
	for (const kind of ["modified", "missing", "extra"]) {
		const b = a.createBackup(f);
		const targetDir = path.join(f.root, kind);
		const photo = path.join(b, "data/storage/旅行 一.jpg");
		if (kind === "modified") fs.writeFileSync(photo, "wrong");
		if (kind === "missing") fs.unlinkSync(photo);
		if (kind === "extra") fs.writeFileSync(path.join(b, "data/extra"), "wrong");
		assert.throws(() => a.restoreBackup({ backupDir: b, targetDir }));
		assert.equal(fs.existsSync(targetDir), false);
	}
});
test("unsafe paths, Windows aliases, duplicate and incomplete manifests are rejected", (t) => {
	const a = api();
	const f = fixture(t);
	for (const bad of [
		"../outside",
		"data/../outside",
		"data/C:secret",
		"data/foo\\bar",
		"data/foo.",
		"data/foo ",
		"/absolute",
	]) {
		const b = a.createBackup(f);
		const file = path.join(b, "backup.json");
		const m = JSON.parse(fs.readFileSync(file));
		m.files[0].path = bad;
		fs.writeFileSync(file, JSON.stringify(m));
		assert.throws(() => a.verifyBackup(b));
	}
	for (const kind of ["duplicate", "incomplete", "version"]) {
		const b = a.createBackup(f);
		const file = path.join(b, "backup.json");
		const m = JSON.parse(fs.readFileSync(file));
		if (kind === "duplicate")
			m.files.push({ ...m.files[0], path: m.files[0].path.toUpperCase() });
		if (kind === "incomplete")
			m.files = m.files.filter((x) => x.path !== "data/.app-secret");
		if (kind === "version") m.version = 999;
		fs.writeFileSync(file, JSON.stringify(m));
		assert.throws(() => a.verifyBackup(b));
	}
});
test("uninitialized data or nested backup locations fail without success marker", (t) => {
	const a = api();
	const f = fixture(t);
	fs.unlinkSync(path.join(f.dataDir, ".session-password"));
	assert.throws(() => a.createBackup(f));
	assert.equal(fs.existsSync(f.backupRoot), false);
	fs.writeFileSync(path.join(f.dataDir, ".session-password"), "test");
	assert.throws(() =>
		a.createBackup({ ...f, backupRoot: path.join(f.dataDir, "backups") }),
	);
});
test("key symlink can materialize adjacent key; other links cannot escape data", (t) => {
	const a = api();
	const f = fixture(t);
	fs.unlinkSync(path.join(f.dataDir, ".app-secret"));
	fs.writeFileSync(path.join(f.dataDir, ".app-secret.abc.key"), "key-target");
	try {
		fs.symlinkSync(
			".app-secret.abc.key",
			path.join(f.dataDir, ".app-secret"),
			"file",
		);
	} catch (e) {
		if (e.code === "EPERM") {
			t.skip("Windows account cannot create file symlinks");
			return;
		}
		throw e;
	}
	const b = a.createBackup(f);
	assert.equal(
		fs.readFileSync(path.join(b, "data/.app-secret"), "utf8"),
		"key-target",
	);
	a.verifyBackup(b);
	fs.symlinkSync(f.configFile, path.join(f.dataDir, "storage/outside"), "file");
	assert.throws(() => a.createBackup(f));
});
test("a failed copy leaves no success manifest", (t) => {
	const a = api();
	const f = fixture(t);
	fs.mkdirSync(path.join(f.dataDir, "storage/unsupported"));
	const read = fs.readFileSync;
	let calls = 0;
	fs.readFileSync = function (file, ...rest) {
		if (String(file).includes("旅行 一.jpg"))
			throw new Error("simulated disk read failure");
		calls++;
		return read.call(this, file, ...rest);
	};
	try {
		assert.throws(() => a.createBackup(f), /simulated/);
	} finally {
		fs.readFileSync = read;
	}
	assert.ok(calls > 0);
	for (const name of fs.readdirSync(f.backupRoot))
		assert.equal(
			fs.existsSync(path.join(f.backupRoot, name, "backup.json")),
			false,
		);
});
test("running service is stopped, overlap checked again, then always restarted", async () => {
	const a = api();
	const events = [];
	const adapter = {
		isRunning: () => true,
		stop: () => events.push("stop"),
		assertNoWriters: () => events.push("check"),
		start: () => events.push("start"),
	};
	await a.withStoppedService(adapter, () => events.push("copy"));
	assert.deepEqual(events, ["stop", "check", "copy", "start"]);
	events.length = 0;
	await assert.rejects(
		() =>
			a.withStoppedService(adapter, () => {
				throw Error("copy failed");
			}),
		/copy failed/,
	);
	assert.deepEqual(events, ["stop", "check", "start"]);
});
test("shared writer refusal and restart failure cannot be reported as success", async () => {
	const a = api();
	const events = [];
	await assert.rejects(
		() =>
			a.withStoppedService(
				{
					isRunning: () => true,
					stop: () => events.push("stop"),
					assertNoWriters: () => {
						throw Error("shared writer");
					},
					start: () => events.push("start"),
				},
				() => events.push("copy"),
			),
		/shared writer/,
	);
	assert.deepEqual(events, ["stop", "start"]);
	await assert.rejects(
		() =>
			a.withStoppedService(
				{
					isRunning: () => true,
					stop: () => {},
					assertNoWriters: () => {},
					start: () => {
						throw Error("restart failed");
					},
				},
				() => 42,
			),
		/restart failed/,
	);
});
test("stopped service remains stopped and native paths detect overlap", async () => {
	const a = api();
	let started = false;
	assert.equal(
		await a.withStoppedService(
			{
				isRunning: () => false,
				stop: () => {
					throw Error("not called");
				},
				assertNoWriters: () => {},
				start: () => {
					started = true;
				},
			},
			() => 42,
		),
		42,
	);
	assert.equal(started, false);
	assert.ok(
		a.pathsOverlap(
			"D:/博客/.local/chronoframe/data",
			"d:/博客/.local/chronoframe/data",
		),
	);
	assert.ok(a.pathsOverlap("D:/博客/.local/chronoframe/data", "d:/博客"));
	assert.equal(
		a.pathsOverlap(
			"D:/博客/.local/chronoframe/data",
			"D:/博客/.local/chronoframe/data-other",
		),
		false,
	);
});
test("entry accepts only the two exact local URLs; malformed values produce no link", () => {
	assert.ok(fs.existsSync(entryModule), "Entry implementation missing");
	const { getChronoframeEntry } = require(entryModule);
	assert.equal(getChronoframeEntry().state, "unconfigured");
	assert.equal(getChronoframeEntry("  ").url, null);
	for (const url of ["http://127.0.0.1:3000/", "http://localhost:3000/"])
		assert.deepEqual(getChronoframeEntry(url), { state: "configured", url });
	for (const url of [
		"http://user:pass@localhost:3000/",
		"http://localhost:3000/?",
		"http://localhost:3000/#",
		"http://localhost:3000/a/../",
		"http://127.1:3000/",
		"http://LOCALHOST:3000/",
		"https://example.com/",
		"http://localhost:3000/dashboard",
		"//localhost:3000/",
		"javascript:alert(1)",
	])
		assert.deepEqual(getChronoframeEntry(url), { state: "invalid", url: null });
});
test("nested directory junctions cannot redirect data, backup or restore writes", (t) => {
	const a = api();
	const f = fixture(t);
	const redirect = path.join(f.root, "public");
	const privateRoot = path.join(f.root, ".local");
	fs.mkdirSync(redirect);
	fs.mkdirSync(privateRoot);
	const link = path.join(privateRoot, "chronoframe");
	try {
		fs.symlinkSync(redirect, link, "junction");
	} catch (e) {
		if (e.code === "EPERM") {
			t.skip("Directory links unavailable");
			return;
		}
		throw e;
	}
	assert.equal(typeof a.assertNoLinksInPath, "function");
	assert.throws(
		() => a.assertNoLinksInPath(path.join(link, "data")),
		/link|链接/i,
	);
	assert.throws(
		() => a.createBackup({ ...f, backupRoot: path.join(link, "backups") }),
		/link|链接/i,
	);
	assert.deepEqual(fs.readdirSync(redirect), []);
	const b = a.createBackup(f);
	assert.throws(
		() =>
			a.restoreBackup({ backupDir: b, targetDir: path.join(link, "restore") }),
		/link|链接/i,
	);
	assert.deepEqual(fs.readdirSync(redirect), []);
	const linkedData = path.join(f.root, "data-link");
	fs.symlinkSync(f.dataDir, linkedData, "junction");
	assert.throws(
		() => a.createBackup({ ...f, dataDir: linkedData }),
		/link|链接/i,
	);
});
if (process.argv.includes("--built"))
	test("built photo entry exposes state without private files or fake online claim", () => {
		const root = path.resolve(__dirname, "../dist");
		const html = fs.readFileSync(path.join(root, "photos/index.html"), "utf8");
		assert.match(html, /name="robots" content="noindex,follow"/);
		assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1);
		if (process.env.CHRONOFRAME_LOCAL_URL === "http://127.0.0.1:3000/") {
			assert.match(html, /本地入口已配置/);
			assert.match(html, /href="http:\/\/127\.0\.0\.1:3000\/"/);
		} else {
			assert.match(html, /尚未连接本地相册/);
			assert.doesNotMatch(
				html,
				/href="http:\/\/(?:127\.0\.0\.1|localhost):3000/,
			);
		}
		const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
		assert.ok(main, "Photo page main content missing");
		assert.equal(
			/<iframe|type="file"|相册在线|synthetic-secret|synthetic-session/.test(
				main,
			),
			false,
			"Photo page contains fake upload/online UI or test data",
		);
		for (const route of ["index.html", "todo/index.html"])
			assert.match(
				fs.readFileSync(path.join(root, route), "utf8"),
				/href="\/photos\/"/,
			);
		for (const name of [".local", "deploy", "scripts", "backup.json"])
			assert.equal(
				fs.existsSync(path.join(root, name)),
				false,
				`Private/runtime directory in static output: ${name}`,
			);
	});
