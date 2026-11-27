import { existsSync } from "node:fs";
import path from "node:path";
import type { ImageMetadata } from "astro";
import sharp from "sharp";
import { type CoverFrontmatter, resolvePostMedia } from "@/utils/post-media";

const localImages = import.meta.glob<ImageMetadata>(
	"/src/content/posts/**/*.{png,jpg,jpeg,webp,avif,gif}",
	{ import: "default" },
);
const publicRoot = path.resolve("public");
const assets = new Map<string, Promise<ImageMetadata | undefined>>();

function loadAsset(source: string) {
	const cached = assets.get(source);
	if (cached) return cached;
	const pending = (async () => {
		if (source.startsWith("/src/content/posts/"))
			return localImages[source]?.();
		const filename = path.resolve(publicRoot, `.${source}`);
		if (
			!filename.startsWith(`${publicRoot}${path.sep}`) ||
			!existsSync(filename)
		)
			return undefined;
		try {
			const { width, height, format } = await sharp(filename).metadata();
			if (!width || !height || !format) return undefined;
			return { src: source, width, height, format } as ImageMetadata;
		} catch {
			return undefined;
		}
	})();
	assets.set(source, pending);
	return pending;
}

export async function getPostMedia(id: string, data: CoverFrontmatter = {}) {
	return resolvePostMedia(id, data, loadAsset);
}
