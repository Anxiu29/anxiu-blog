import type { BackgroundLocalVideo } from "./background-storage";

/** Decode locally before replacing the saved wallpaper; retain a still for paused playback. */
export async function prepareLocalVideo(
	blob: Blob,
	name: string,
): Promise<BackgroundLocalVideo> {
	const url = URL.createObjectURL(blob);
	const probe = document.createElement("video");
	probe.muted = true;
	probe.playsInline = true;
	probe.preload = "auto";
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(
				() => finish(new Error("读取视频超时，请换一个较小的 MP4 文件。")),
				15000,
			);
			const finish = (error?: Error) => {
				window.clearTimeout(timer);
				probe.onloadeddata = null;
				probe.onerror = null;
				error ? reject(error) : resolve();
			};
			probe.onloadeddata = () => finish();
			probe.onerror = () =>
				finish(new Error("这个 MP4 无法解码，请尝试 H.264 编码的视频。"));
			probe.src = url;
			probe.load();
		});
		if (
			!probe.videoWidth ||
			probe.videoWidth * probe.videoHeight > 32000000 ||
			!Number.isFinite(probe.duration) ||
			probe.duration <= 0
		)
			throw new Error("视频尺寸或时长无效，请换一个 MP4 文件。");
		const scale = Math.min(1, 960 / probe.videoWidth, 540 / probe.videoHeight);
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(probe.videoWidth * scale));
		canvas.height = Math.max(1, Math.round(probe.videoHeight * scale));
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("无法生成视频封面，请重试。");
		ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
		const poster = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(new Error("无法保存视频封面。")),
				"image/jpeg",
				0.82,
			),
		);
		return { blob, name, poster };
	} finally {
		probe.pause();
		probe.removeAttribute("src");
		probe.load();
		URL.revokeObjectURL(url);
	}
}
