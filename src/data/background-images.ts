import type {
	BackgroundImageId,
	BackgroundVideoId,
} from "@/scripts/background-settings";
export const backgroundImages: {
	id: BackgroundImageId;
	title: string;
	src: string;
	thumbnail: string;
}[] = [
	{
		id: "cloud-pals",
		title: "云下小憩",
		src: "/images/backgrounds/cloud-pals.webp",
		thumbnail: "/images/backgrounds/cloud-pals-thumb.webp",
	},
	{
		id: "mist-lake",
		title: "云雾倒影",
		src: "/images/backgrounds/mist-lake.webp",
		thumbnail: "/images/backgrounds/mist-lake-thumb.webp",
	},
	{
		id: "cozy-room",
		title: "林间书屋",
		src: "/images/backgrounds/cozy-room.webp",
		thumbnail: "/images/backgrounds/cozy-room-thumb.webp",
	},
	{
		id: "blue-sky",
		title: "晴朗天空",
		src: "/images/backgrounds/blue-sky.webp",
		thumbnail: "/images/backgrounds/blue-sky-thumb.webp",
	},
	{
		id: "full-moon",
		title: "圆月之夜",
		src: "/images/backgrounds/full-moon.webp",
		thumbnail: "/images/backgrounds/full-moon-thumb.webp",
	},
	{
		id: "your-name",
		title: "你的名字",
		src: "/images/backgrounds/your-name.webp",
		thumbnail: "/images/backgrounds/your-name-thumb.webp",
	},
];

export const backgroundVideos: {
	id: BackgroundVideoId;
	title: string;
	src: string;
	poster: string;
	thumbnail: string;
	duration: string;
}[] = [
	{
		id: "luo-xiaohei",
		title: "罗小黑 · 林间微光",
		src: "/images/backgrounds/anime-live.mp4",
		poster: "/images/backgrounds/anime-live-poster.webp",
		thumbnail: "/images/backgrounds/anime-live-thumb.webp",
		duration: "约 20 秒",
	},
];
