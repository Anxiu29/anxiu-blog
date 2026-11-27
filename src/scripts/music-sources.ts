export type MusicTrack = {
	title: string;
	artist: string;
	url: string;
	cover?: string;
	lrc?: string;
};
export type MusicServer = "netease" | "tencent";
export type LyricLine = { time: number; text: string };

export function parsePlaylistInput(value: string, server: MusicServer): string {
	let input = value.trim();
	if (!/^[1-9]\d{0,19}$/.test(input)) {
		try {
			const link = new URL(input);
			const hosts =
				server === "netease"
					? ["music.163.com", "y.music.163.com"]
					: ["y.qq.com", "i.y.qq.com"];
			if (
				link.protocol !== "https:" ||
				!hosts.includes(link.hostname) ||
				link.username ||
				link.password
			)
				throw Error();
			const path = link.hash.startsWith("#/")
				? link.hash.slice(1)
				: link.pathname + link.search;
			if (server === "netease") {
				const parsed = new URL(path, link.origin);
				if (!/^\/playlist\/?$/.test(parsed.pathname)) throw Error();
				input = parsed.searchParams.get("id") || "";
			} else {
				const parsed = new URL(path, link.origin);
				input =
					/^\/n\/ryqq\/playlist\/([1-9]\d*)\/?$/.exec(parsed.pathname)?.[1] ||
					(/\/detail\/taoge\/index\.html$/.test(parsed.pathname)
						? parsed.searchParams.get("id") || ""
						: "");
			}
		} catch {
			throw new Error(
				"请填写所选平台的歌单 ID 或完整歌单链接。短链接请先在浏览器打开，再复制完整地址。",
			);
		}
	}
	if (!/^[1-9]\d{0,19}$/.test(input))
		throw new Error(
			"歌单 ID 应为有效数字；请确认复制的是歌单，而不是单曲或短链接。",
		);
	return input;
}

function safeRemoteUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 4096) return;
	try {
		const url = new URL(value);
		if (url.protocol === "https:" && !url.username && !url.password)
			return url.href;
	} catch {
		/* Ignore unusable metadata. */
	}
}

export function isInlineLrc(value: string): boolean {
	return /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(value.slice(0, 200000));
}

export function normalizeMetingTracks(data: unknown): MusicTrack[] {
	if (!Array.isArray(data)) return [];
	const tracks: MusicTrack[] = [];
	for (const item of data.slice(0, 1000)) {
		if (!item || typeof item !== "object") continue;
		const url = safeRemoteUrl(item.url);
		if (!url) continue;
		const title = String(item.title || item.name || "未命名曲目").slice(0, 200);
		const artist = String(item.author || item.artist || "未知歌手").slice(
			0,
			200,
		);
		const lrc =
			typeof item.lrc === "string" && isInlineLrc(item.lrc)
				? item.lrc.slice(0, 200000)
				: safeRemoteUrl(item.lrc);
		tracks.push({
			title,
			artist,
			url,
			cover: safeRemoteUrl(item.pic || item.cover),
			lrc,
		});
		if (tracks.length === 300) break;
	}
	return tracks;
}

// Endpoints from the reference theme; never load remote JavaScript or send cookies.
const endpoints = [
	"https://api.i-meto.com/meting/api",
	"https://api.injahow.cn/meting/",
];
export function officialMusicPage(value: string): string | undefined {
	try {
		const original = new URL(value);
		const known = endpoints.some((endpoint) => {
			const url = new URL(endpoint);
			return (
				url.origin === original.origin && url.pathname === original.pathname
			);
		});
		const id = original.searchParams.get("id");
		if (
			known &&
			original.searchParams.get("server") === "netease" &&
			original.searchParams.get("type") === "url" &&
			id &&
			/^[1-9]\d{0,19}$/.test(id)
		)
			return `https://music.163.com/#/song?id=${id}`;
	} catch {
		/* A public audio file need not have an official platform page. */
	}
}

export function musicAudioSources(value: string): string[] {
	const sources = [value];
	try {
		const original = new URL(value);
		if (
			!endpoints.some((endpoint) => {
				const known = new URL(endpoint);
				return (
					known.origin === original.origin &&
					known.pathname === original.pathname
				);
			})
		)
			return sources;
		const server = original.searchParams.get("server");
		const id = original.searchParams.get("id");
		if (
			original.searchParams.get("type") !== "url" ||
			!id ||
			!/^[1-9]\d{0,19}$/.test(id) ||
			!["netease", "tencent"].includes(server || "")
		)
			return sources;
		for (const endpoint of endpoints) {
			const backup = new URL(endpoint);
			if (
				backup.origin === original.origin &&
				backup.pathname === original.pathname
			)
				continue;
			backup.search = new URLSearchParams({
				server: server as string,
				type: "url",
				id,
			}).toString();
			sources.push(backup.href);
		}
	} catch {
		/* Non-Meting curated URLs keep their original source. */
	}
	return sources;
}

export async function loadMetingPlaylist(
	source: { server: MusicServer; id: string },
	signal: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<MusicTrack[]> {
	for (const endpoint of endpoints) {
		signal.throwIfAborted();
		const request = new AbortController();
		const abort = () => request.abort();
		signal.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(abort, 8000);
		try {
			const url = new URL(endpoint);
			url.search = new URLSearchParams({
				server: source.server,
				type: "playlist",
				id: source.id,
			}).toString();
			const response = await fetcher(url.href, {
				signal: request.signal,
				credentials: "omit",
				referrerPolicy: "no-referrer",
			});
			if (!response.ok) throw Error();
			const text = await response.text();
			if (text.length > 2000000) throw Error();
			const tracks = normalizeMetingTracks(JSON.parse(text));
			signal.throwIfAborted();
			if (!tracks.length) throw Error();
			return tracks;
		} catch {
			signal.throwIfAborted();
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		}
	}
	throw new Error(
		"暂时读不到这个歌单。请检查歌单是否公开、平台是否选对，或稍后重试；当前歌单仍可继续听。",
	);
}

export function parseLrc(source: string): LyricLine[] {
	const lines: LyricLine[] = [];
	for (const row of source.slice(0, 200000).split(/\r?\n/).slice(0, 5000)) {
		const tags = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
		const text = row
			.replace(/\[[^\]]*\]/g, "")
			.trim()
			.slice(0, 500);
		if (!text) continue;
		for (const tag of tags) {
			if (Number(tag[2]) >= 60) continue;
			const time =
				Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] || "0"}`);
			lines.push({ time, text });
		}
	}
	return lines.sort((a, b) => a.time - b.time);
}

export function activeLyricIndex(lines: LyricLine[], time: number): number {
	let left = 0;
	let right = lines.length - 1;
	let active = -1;
	while (left <= right) {
		const mid = (left + right) >>> 1;
		if (lines[mid].time <= time) {
			active = mid;
			left = mid + 1;
		} else right = mid - 1;
	}
	return active;
}
