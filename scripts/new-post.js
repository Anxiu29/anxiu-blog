/* Local draft creation only. Saving a file does not build or publish the site. */
import fs from "node:fs";
import path from "node:path";

const usage = `Usage: pnpm new-post <relative-name.md|mdx> [options]
Options: --title TEXT --description TEXT --category TEXT --tags tag1,tag2
         --date YYYY-MM-DD --lang TEXT --help
Creates a draft inside src/content/posts. Run from the project root.`;

function createPost(args) {
	if (args.length === 1 && args[0] === "--help") {
		console.log(usage);
		return;
	}
	if (!args[0] || args[0].startsWith("--")) throw new Error(usage);
	const original = args[0];
	if (path.win32.isAbsolute(original) || path.posix.isAbsolute(original)) throw new Error("Use a relative filename inside posts.");
	const segments = original.replaceAll("\\", "/").split("/");
	for (const segment of segments) {
		if (!segment || segment === "." || segment === ".." || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)) {
			throw new Error("Filename contains an unsafe or reserved path segment.");
		}
	}
	let filename = segments.pop();
	if (!/\.(md|mdx)$/iu.test(filename)) filename += ".md";
	const options = {};
	const allowed = new Set(["title", "description", "category", "tags", "date", "lang"]);
	for (let i = 1; i < args.length; i += 2) {
		const key = args[i].replace(/^--/, "");
		if (!args[i].startsWith("--") || !allowed.has(key) || key in options || args[i + 1] === undefined || args[i + 1].startsWith("--")) throw new Error(`Invalid option: ${args[i]}\n${usage}`);
		options[key] = args[i + 1];
	}
	const now = new Date();
	const date = options.date ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("--date must be a real calendar date in YYYY-MM-DD format.");
	const title = options.title ?? filename.replace(/\.(md|mdx)$/iu, "");
	if (!title.trim()) throw new Error("--title must not be empty.");
	const root = path.resolve("src/content/posts");
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("src/content/posts is missing. Run this command from the project root.");
	// Reject junctions/symlinks in the content root and every existing ancestor.
	let directory = process.cwd();
	for (const segment of ["src", "content", "posts", ...segments]) {
		directory = path.join(directory, segment);
		if (fs.existsSync(directory)) {
			const stat = fs.lstatSync(directory);
			if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Post directories must be real directories, not symlinks or junctions.");
		} else {
			fs.mkdirSync(directory);
		}
	}
	const target = path.join(directory, filename);
	const alternate = target.replace(/\.(md|mdx)$/iu, filename.toLowerCase().endsWith(".mdx") ? ".md" : ".mdx");
	if (fs.existsSync(alternate)) throw new Error("A post with the same name and another Markdown extension already exists.");
	const tags = [...new Set((options.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];
	const content = `---\ntitle: ${JSON.stringify(title)}\npublished: ${date}\ndescription: ${JSON.stringify(options.description ?? "")}\nimage: ''\ntags: ${JSON.stringify(tags)}\ncategory: ${JSON.stringify(options.category ?? "")}\ndraft: true\nlang: ${JSON.stringify(options.lang ?? "")}\n---\n\n`;
	// Exclusive creation prevents accidental overwrite even if a file appears
	// between validation and writing.
	fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
	console.log(`Draft created: ${path.relative(process.cwd(), target)}\nEdit and preview it, then set draft: false when ready. This command does not publish.`);
}

try {
	createPost(process.argv.slice(2));
} catch (error) {
	console.error(`Error: ${error.message}`);
	process.exitCode = 1;
}
