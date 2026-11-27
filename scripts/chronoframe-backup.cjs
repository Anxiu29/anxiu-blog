const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const required = [
	"data/app.sqlite3",
	"data/.session-password",
	"data/.app-secret",
	"runtime.json",
];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function mountPath(value) {
	return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
function pathsOverlap(rawA, rawB) {
	const a = mountPath(rawA);
	const b = mountPath(rawB);
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
/** Reject existing link/junction ancestors before any private write or mount. */
function assertNoLinksInPath(target) {
	if (process.platform === "win32" && Number(process.versions.node.split(".")[0]) < 26)
		throw Error("Windows directory link checks require management Node >=26; refusing private file operations");
	const absolute = path.resolve(target);
	const parsed = path.parse(absolute);
	let current = parsed.root;
	for (const part of absolute
		.slice(parsed.root.length)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		let stat;
		try {
			stat = fs.lstatSync(current);
		} catch (e) {
			if (e.code === "ENOENT") break;
			throw e;
		}
		if (stat.isSymbolicLink())
			throw Error(`Directory link/junction is not allowed: ${current}`);
	}
	return absolute;
}
function safeRelative(value) {
	if (
		typeof value !== "string" ||
		!value ||
		value.includes("\\") ||
		value.includes(":") ||
		Array.from(value).some((character) => character.charCodeAt(0) < 32)
	)
		throw Error("Unsafe backup path");
	if (
		value
			.split("/")
			.some((s) => !s || s === "." || s === ".." || /[. ]$/.test(s))
	)
		throw Error("Unsafe backup path");
	if (value !== "runtime.json" && !value.startsWith("data/"))
		throw Error("Unexpected backup path");
	return value;
}
function filesIn(dir, { keyLink = false } = {}) {
	if (fs.lstatSync(dir).isSymbolicLink())
		throw Error("Directory links are not allowed");
	const list = [];
	function visit(current, relative = "") {
		for (const name of fs.readdirSync(current).sort()) {
			const rel = relative ? `${relative}/${name}` : name;
			const full = path.join(current, name);
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) {
				const target = fs.readlinkSync(full);
				if (
					!keyLink ||
					rel !== ".app-secret" ||
					!/^\.app-secret\.[a-zA-Z0-9_-]+\.key$/.test(target)
				)
					throw Error(`Unsupported symbolic link: ${rel}`);
				const key = path.join(dir, target);
				if (!fs.lstatSync(key).isFile() || fs.lstatSync(key).isSymbolicLink())
					throw Error("Invalid app secret target");
				list.push(rel);
			} else if (stat.isDirectory()) visit(full, rel);
			else if (stat.isFile()) list.push(rel);
			else throw Error(`Unsupported file: ${rel}`);
		}
	}
	visit(dir);
	return list;
}
function validateRuntime(runtime) {
	if (
		runtime?.kind !== "native" ||
		!/^\d+\.\d+\.\d+$/.test(runtime.version) ||
		!/^22\.\d+\.\d+$/.test(runtime.nodeVersion) ||
		!/^[a-f0-9]{40}$/.test(runtime.commit)
	)
		throw Error("A pinned native ChronoFrame runtime is required");
}
function createBackup({ dataDir, backupRoot, configFile, runtime }) {
	assertNoLinksInPath(dataDir);
	assertNoLinksInPath(backupRoot);
	dataDir = fs.realpathSync(dataDir);
	backupRoot = path.resolve(backupRoot);
	validateRuntime(runtime);
	if (pathsOverlap(dataDir, backupRoot))
		throw Error("Backup directory must be separate from data");
	const files = filesIn(dataDir, { keyLink: true });
	for (const name of required.filter((x) => x.startsWith("data/")))
		if (!files.includes(name.slice(5)))
			throw Error(`Data is not initialized: missing ${name}`);
	const config = fs.readFileSync(configFile);
	const recorded = JSON.parse(config.toString("utf8").replace(/^\uFEFF/, ""));
	validateRuntime(recorded);
	if (
		["kind", "version", "nodeVersion", "commit"].some(
			(key) => recorded[key] !== runtime[key],
		)
	)
		throw Error("Runtime configuration does not match backup version");
	fs.mkdirSync(backupRoot, { recursive: true });
	// Exclusive mkdir prevents any previous backup from being overwritten.
	const dest = path.join(
		backupRoot,
		new Date().toISOString().replaceAll(":", "-") +
			"-" +
			crypto.randomBytes(6).toString("hex"),
	);
	fs.mkdirSync(dest);
	const entries = [];
	function copy(name, bytes) {
		safeRelative(name);
		const target = path.join(dest, name);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, bytes, { flag: "wx" });
		const stored = fs.readFileSync(target);
		if (!stored.equals(bytes)) throw Error("Backup copy verification failed");
		entries.push({ path: name, size: bytes.length, sha256: hash(bytes) });
	}
	for (const name of files)
		copy(`data/${name}`, fs.readFileSync(path.join(dataDir, name)));
	copy("runtime.json", config);
	const manifest = {
		format: "anxiu-chronoframe-backup",
		version: 2,
		complete: true,
		createdAt: new Date().toISOString(),
		runtime,
		files: entries,
	};
	fs.writeFileSync(
		path.join(dest, "backup.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		{ flag: "wx" },
	);
	verifyBackup(dest);
	return dest;
}
function verifyBackup(backupDir) {
	assertNoLinksInPath(backupDir);
	if (fs.lstatSync(backupDir).isSymbolicLink())
		throw Error("Backup directory links are not allowed");
	const all = filesIn(backupDir);
	const manifestFile = path.join(backupDir, "backup.json");
	if (fs.statSync(manifestFile).size > 16 * 1024 * 1024)
		throw Error("Backup manifest too large");
	const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
	if (
		m.format !== "anxiu-chronoframe-backup" ||
		m.version !== 2 ||
		m.complete !== true ||
		!Array.isArray(m.files) ||
		!m.files.length
	)
		throw Error("Unsupported or incomplete backup manifest");
	validateRuntime(m.runtime);
	const names = new Set();
	for (const e of m.files) {
		safeRelative(e.path);
		const name = e.path.toLowerCase();
		if (names.has(name)) throw Error("Duplicate backup path");
		names.add(name);
		if (
			!Number.isSafeInteger(e.size) ||
			e.size < 0 ||
			typeof e.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(e.sha256)
		)
			throw Error("Invalid backup file metadata");
		if (!all.includes(e.path)) throw Error(`Backup file missing: ${e.path}`);
		const data = fs.readFileSync(path.join(backupDir, e.path));
		if (data.length !== e.size || hash(data) !== e.sha256)
			throw Error(`Backup checksum mismatch: ${e.path}`);
	}
	for (const r of required)
		if (!m.files.some((e) => e.path === r))
			throw Error("Required backup file missing");
	const recorded = JSON.parse(
		fs
			.readFileSync(path.join(backupDir, "runtime.json"), "utf8")
			.replace(/^\uFEFF/, ""),
	);
	validateRuntime(recorded);
	if (
		["kind", "version", "nodeVersion", "commit"].some(
			(key) => recorded[key] !== m.runtime[key],
		)
	)
		throw Error("Backup runtime version mismatch");
	if (
		all.length !== m.files.length + 1 ||
		all.some((n) => n !== "backup.json" && !m.files.some((e) => e.path === n))
	)
		throw Error("Unlisted backup files");
	return m;
}
function restoreBackup({ backupDir, targetDir }) {
	const m = verifyBackup(backupDir);
	targetDir = path.resolve(targetDir);
	assertNoLinksInPath(targetDir);
	if (pathsOverlap(targetDir, path.resolve(backupDir)))
		throw Error("Restore directory must be separate from backup");
	if (fs.existsSync(targetDir))
		throw Error("Restore target already exists; choose a new directory");
	fs.mkdirSync(targetDir); // No recursive creation: parent must already exist.
	for (const e of m.files.filter((e) => e.path.startsWith("data/"))) {
		const data = fs.readFileSync(path.join(backupDir, e.path));
		if (hash(data) !== e.sha256) throw Error("Backup changed during restore");
		const target = path.join(targetDir, e.path.slice(5));
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, data, { flag: "wx" });
		if (hash(fs.readFileSync(target)) !== e.sha256)
			throw Error("Restore verification failed");
	}
	return m;
}
async function withStoppedService(adapter, operation) {
	const wasRunning = await adapter.isRunning();
	let result;
	let operationError;
	try {
		if (wasRunning) await adapter.stop();
		await adapter.assertNoWriters();
		result = await operation();
	} catch (e) {
		operationError = e;
	}
	let restartError;
	if (wasRunning)
		try {
			await adapter.start();
		} catch (e) {
			restartError = e;
		}
	if (operationError && restartError)
		throw new AggregateError(
			[operationError, restartError],
			`${operationError.message}; restart failed: ${restartError.message}`,
		);
	if (operationError) throw operationError;
	if (restartError) throw restartError;
	return result;
}
module.exports = {
	assertNoLinksInPath,
	createBackup,
	verifyBackup,
	restoreBackup,
	withStoppedService,
	pathsOverlap,
};
