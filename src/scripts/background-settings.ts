export const BACKGROUND_KEY = "anxiu-background-v1";
export const BACKGROUND_MODES = ["image", "video", "color"] as const;
export const BACKGROUND_IMAGE_IDS = [
	"cloud-pals",
	"mist-lake",
	"cozy-room",
	"blue-sky",
	"full-moon",
	"your-name",
] as const;
export type BackgroundImageId = (typeof BACKGROUND_IMAGE_IDS)[number];
export const BACKGROUND_VIDEO_IDS = ["luo-xiaohei", "night-cuddle"] as const;
export type BackgroundVideoId = (typeof BACKGROUND_VIDEO_IDS)[number];
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];
export interface BackgroundSettings {
	version: 1;
	mode: BackgroundMode;
	color: string;
	overlay: number;
	blur: number;
	wallpaper?: BackgroundImageId;
	videoPaused: boolean;
	video: BackgroundVideoId;
}
export const DEFAULT_BACKGROUND: BackgroundSettings = {
	version: 1,
	mode: "video",
	wallpaper: "cloud-pals",
	color: "#9dcdf0",
	overlay: 40,
	blur: 0,
	videoPaused: false,
	video: "luo-xiaohei",
};
function bounded(value: unknown, fallback: number, min: number, max: number) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.min(max, Math.round(value)))
		: fallback;
}
export function normalizeBackground(value: unknown): BackgroundSettings {
	const d = { ...DEFAULT_BACKGROUND };
	if (!value || typeof value !== "object" || Array.isArray(value)) return d;
	const v = value as Record<string, unknown>;
	if (v.version !== 1 || !BACKGROUND_MODES.includes(v.mode as BackgroundMode))
		return d;
	const wallpaper = BACKGROUND_IMAGE_IDS.includes(
		v.wallpaper as BackgroundImageId,
	)
		? (v.wallpaper as BackgroundImageId)
		: v.wallpaper !== undefined
			? d.wallpaper
			: undefined;
	return {
		version: 1,
		mode: v.mode as BackgroundMode,
		...(wallpaper ? { wallpaper } : {}),
		color:
			typeof v.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color)
				? v.color.toLowerCase()
				: d.color,
		overlay: bounded(v.overlay, d.overlay, 20, 95),
		blur: bounded(v.blur, d.blur, 0, 20),
		videoPaused: v.videoPaused === true,
		video: BACKGROUND_VIDEO_IDS.includes(v.video as BackgroundVideoId)
			? (v.video as BackgroundVideoId)
			: d.video,
	};
}
export function readBackground(
	storage: Pick<Storage, "getItem">,
): BackgroundSettings {
	try {
		return normalizeBackground(
			JSON.parse(storage.getItem(BACKGROUND_KEY) || "null"),
		);
	} catch {
		return { ...DEFAULT_BACKGROUND };
	}
}
export function saveBackground(
	storage: Pick<Storage, "setItem">,
	settings: BackgroundSettings,
): boolean {
	try {
		storage.setItem(
			BACKGROUND_KEY,
			JSON.stringify(normalizeBackground(settings)),
		);
		return true;
	} catch {
		return false;
	}
}
