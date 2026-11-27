import { createHash } from "node:crypto";
import { discoveryRecords } from "@/data/blog-discovery";
import { projectNotes, tools } from "@/data/tools";
import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";
export async function getJournalSearchIndex() {
	const posts = await getSortedPosts();
	const records = [
		...posts
			.filter((p) => !p.data.password)
			.map((p) => ({
				title: p.data.title,
				description: p.data.description,
				url: getPostUrlBySlug(p.id),
				type: "文章",
				text:
					(p.body || "") + " " + p.data.tags.join(" ") + " " + p.data.category,
			})),
		...tools.map((t) => ({
			title: t.title,
			description: t.description,
			url: t.href,
			type: "工具",
			text: t.keywords,
		})),
		...projectNotes.map((record) => ({ ...record, type: "作品" })),
		...discoveryRecords,
	];

	const version = createHash("sha256")
		.update(JSON.stringify(records))
		.digest("hex")
		.slice(0, 12);
	const articlePaths = records
		.filter((record) => record.type === "文章")
		.map((record) => record.url);
	return { records, version, articlePaths };
}
