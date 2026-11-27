export interface PostMedia {
	src: string;
	caption: string;
	width: number;
	height: number;
	thumbnail?: boolean;
	position?: string;
	frontmatter?: boolean;
}
export interface CoverFrontmatter {
	image?: string;
	imageAlt?: string;
	imagePosition?: "center" | "top" | "bottom" | "left" | "right";
	password?: string;
	templateDemo?: boolean;
}
type Asset = { src: string; width: number; height: number };

// Actual project screenshots only. An absent image never gets a generated cover.
const projectMedia: Record<string, PostMedia> = {
	"webhid-tool-guide": {
		src: "/images/projects/hid-interface.jpg",
		caption: "HID 工具界面，未连接设备",
		width: 800,
		height: 230,
		thumbnail: true,
		position: "top",
	},
	"anxiu-demo": {
		src: "/images/projects/anxiu-interface.jpg",
		caption: "Anxiu 的 RK-C98 演示模式",
		width: 1280,
		height: 800,
	},
	"fog-town-nightwalk": {
		src: "/images/projects/fog-town.jpg",
		caption: "雾镇夜行实际运行界面",
		width: 1280,
		height: 800,
	},
};

export async function resolvePostMedia(
	id: string,
	data: CoverFrontmatter,
	load: (source: string) => Promise<Asset | undefined>,
): Promise<PostMedia | undefined> {
	if (data.password || data.templateDemo) return undefined;
	const key = id.replace(/\.(md|mdx)$/, "");
	const fallback = projectMedia[key];
	const image = data.image?.trim();
	if (!image) return fallback && { ...fallback, position: data.imagePosition };
	// Cover assets are local build inputs, never remote requests or CSS/URL snippets.
	if (
		/[\\%?:#]/.test(image) ||
		[...image].some((character) => character.charCodeAt(0) < 32) ||
		image.startsWith("//") ||
		!/\.(avif|webp|png|jpe?g|gif)$/i.test(image)
	)
		return fallback;
	let source: string;
	if (image.startsWith("/")) {
		if (image.split("/").includes("..")) return fallback;
		source = image;
	} else {
		const parts = key.split("/").slice(0, -1);
		for (const segment of image.split("/")) {
			if (!segment || segment === ".") continue;
			if (segment === "..") {
				if (!parts.length) return fallback;
				parts.pop();
			} else parts.push(segment);
		}
		source = `/src/content/posts/${parts.join("/")}`;
	}
	const asset = await load(source);
	if (
		!asset ||
		!Number.isFinite(asset.width) ||
		!Number.isFinite(asset.height) ||
		asset.width <= 0 ||
		asset.height <= 0
	)
		return fallback;
	return {
		...asset,
		caption: data.imageAlt?.trim() || "文章封面",
		position: data.imagePosition,
		frontmatter: true,
	};
}
