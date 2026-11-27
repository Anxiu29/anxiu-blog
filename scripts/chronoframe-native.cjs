const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const {
	createBackup,
	verifyBackup,
	restoreBackup,
	assertNoLinksInPath,
} = require("./chronoframe-backup.cjs");
function readRuntime(home) {
	assertNoLinksInPath(home);
	const runtime = JSON.parse(
		fs
			.readFileSync(path.join(home, "runtime.json"), "utf8")
			.replace(/^\uFEFF/, ""),
	);
	if (
		runtime.kind !== "native" ||
		!/^\d+\.\d+\.\d+$/.test(runtime.version) ||
		!/^22\.\d+\.\d+$/.test(runtime.nodeVersion) ||
		!/^[a-f0-9]{40}$/.test(runtime.commit)
	)
		throw Error("Invalid pinned native runtime");
	let commit;
	try {
		commit = execFileSync(
			"git",
			["-C", path.join(home, "source"), "rev-parse", "HEAD"],
			{
				encoding: "utf8",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		).trim();
	} catch {
		throw Error("Native source commit cannot be verified");
	}
	if (commit !== runtime.commit) throw Error("Native source commit mismatch");
	return runtime;
}
function resolveRestoreTarget(home, target) {
	const restores = path.resolve(home, ".state/restores");
	target = path.resolve(target);
	if (!target.startsWith(restores + path.sep))
		throw Error("Restore destination is outside the restores directory");
	assertNoLinksInPath(target);
	if (fs.existsSync(target))
		throw Error("Restore destination already existing");
	return target;
}
function isPotentialGalleryProcess(commandLine) {
	// A relative entry's cwd is not exposed by Win32_Process. Refuse ambiguous
	// index.mjs servers too; a false refusal is safer than a live database copy.
	return /(?:^|[\\/\s"'])index\.mjs(?:$|[\s"'])/i.test(commandLine || "");
}
async function assertStopped(home) {
	const record = path.join(home, ".state/process.json");
	if (fs.existsSync(record)) {
		const info = JSON.parse(
			fs.readFileSync(record, "utf8").replace(/^\uFEFF/, ""),
		);
		try {
			process.kill(info.processId, 0);
			throw Error("Gallery is running; use stop before backup");
		} catch (e) {
			if (e.code !== "ESRCH") throw e;
		}
	}
	if (process.platform === "win32") {
		let processes;
		try {
			const json = execFileSync(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction Stop | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress",
				],
				{
					encoding: "utf8",
					windowsHide: true,
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 15000,
				},
			);
			processes = JSON.parse(json.trim() || "[]");
		} catch {
			throw Error("Cannot verify native process writers; backup/start refused");
		}
		for (const info of [processes].flat()) {
			if (!info.CommandLine || isPotentialGalleryProcess(info.CommandLine))
				throw Error(
					"Possible manual gallery instance found; stop index.mjs servers before backup/start",
				);
		}
	}
	await new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", () =>
			reject(Error("Port 3000 is occupied; stop all gallery processes first")),
		);
		server.listen(3000, "127.0.0.1", () => server.close(resolve));
	});
}
async function main(args) {
	const action = args.shift();
	const options = {};
	while (args.length) {
		const key = args.shift();
		const value = args.shift();
		if (!["--home", "--backup", "--target"].includes(key) || !value)
			throw Error("Invalid arguments");
		options[key.slice(2)] = value;
	}
	if (!options.home) throw Error("--home is required");
	const home = path.resolve(options.home);
	if (action === "check-stopped") {
		await assertStopped(home);
		console.log("No managed or possible manual gallery writer found.");
	} else if (action === "backup") {
		const runtime = readRuntime(home);
		await assertStopped(home);
		console.log(
			createBackup({
				dataDir: path.join(home, ".state/data"),
				backupRoot: path.join(home, ".state/backups"),
				configFile: path.join(home, "runtime.json"),
				runtime,
			}),
		);
	} else if (action === "verify") {
		if (!options.backup) throw Error("--backup is required");
		const manifest = verifyBackup(path.resolve(options.backup));
		console.log(
			`Backup checksums verified (${manifest.files.length} files); this does not prove application/photo recovery.`,
		);
	} else if (action === "restore") {
		if (!options.backup || !options.target)
			throw Error("--backup and --target are required");
		await assertStopped(home);
		const targetDir = resolveRestoreTarget(home, options.target);
		verifyBackup(path.resolve(options.backup));
		const restoreRoot = path.join(home, ".state/restores");
		assertNoLinksInPath(restoreRoot);
		fs.mkdirSync(restoreRoot, { recursive: true });
		restoreBackup({ backupDir: path.resolve(options.backup), targetDir });
		console.log(
			`Restored files to ${targetDir}; live data was not replaced. Application recovery is still unverified.`,
		);
	} else throw Error("Choose backup, verify or restore");
}
module.exports = {
	readRuntime,
	resolveRestoreTarget,
	isPotentialGalleryProcess,
};
if (require.main === module)
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
