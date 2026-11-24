import { series } from "@/data/blog-discovery";
import type { PostForList } from "./content-utils";
export function getSeriesEntries(posts: PostForList[]) {
	const eligible = posts.filter(
		(p) => !p.data.draft && !p.data.templateDemo && !p.data.password,
	);
	return series.map((topic) => ({
		...topic,
		entries: topic.posts
			.map((id) => eligible.find((p) => p.id.replace(/\.[^.]+$/, "") === id))
			.filter((p): p is PostForList => !!p),
	}));
}
