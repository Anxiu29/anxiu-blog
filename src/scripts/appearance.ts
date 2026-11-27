import { backgroundImages, backgroundVideos } from "@/data/background-images";
import { prepareLocalVideo } from "./background-local-video";
import {
	BACKGROUND_KEY,
	type BackgroundImageId,
	type BackgroundMode,
	DEFAULT_BACKGROUND,
	readBackground,
	saveBackground,
} from "./background-settings";
import {
	type BackgroundLocalVideo,
	type BackgroundPhoto,
	deleteLocalVideo,
	deletePhoto,
	isBackgroundPhotoType,
	MAX_BACKGROUND_BYTES,
	MAX_BACKGROUND_VIDEO_BYTES,
	readLocalVideo,
	readPhoto,
	storeLocalVideo,
	storePhoto,
} from "./background-storage";
import { createBackgroundVideo } from "./background-video";

const initialized = new WeakSet<HTMLDialogElement>();
export function initializeAppearance() {
	const dialog =
		document.querySelector<HTMLDialogElement>("#appearance-dialog");
	const opener = document.querySelector<HTMLButtonElement>("#open-appearance");
	const backdrop = document.querySelector<HTMLElement>("#site-wallpaper");
	if (!dialog || !opener || !backdrop || initialized.has(dialog)) return;
	initialized.add(dialog);
	const fields =
		dialog.querySelector<HTMLFieldSetElement>("#appearance-fields")!;
	const radios = [
		...dialog.querySelectorAll<HTMLInputElement>("[name=background-mode]"),
	];
	const color = dialog.querySelector<HTMLInputElement>("#background-color")!;
	const overlay = dialog.querySelector<HTMLInputElement>(
		"#background-overlay",
	)!;
	const blur = dialog.querySelector<HTMLInputElement>("#background-blur")!;
	const file = dialog.querySelector<HTMLInputElement>("#background-photo")!;
	const builtinButtons = [
		...dialog.querySelectorAll<HTMLButtonElement>("[data-wallpaper]"),
	];
	const videoButtons = [
		...dialog.querySelectorAll<HTMLButtonElement>("[data-video-wallpaper]"),
	];
	const playback = dialog.querySelector<HTMLButtonElement>(
		"#toggle-background-video",
	)!;
	const video = backdrop.querySelector<HTMLVideoElement>(
		"#site-wallpaper-video",
	)!;
	const usePhoto = dialog.querySelector<HTMLButtonElement>(
		"#use-background-photo",
	)!;
	const remove = dialog.querySelector<HTMLButtonElement>(
		"#remove-background-photo",
	)!;
	const status = dialog.querySelector<HTMLElement>("#appearance-status")!;
	const photoName = dialog.querySelector<HTMLElement>(
		"#background-photo-name",
	)!;
	const videoFile = dialog.querySelector<HTMLInputElement>(
		"#background-video-file",
	)!;
	const useLocal = dialog.querySelector<HTMLButtonElement>(
		"#use-background-video",
	)!;
	const removeLocal = dialog.querySelector<HTMLButtonElement>(
		"#remove-background-video",
	)!;
	const videoName = dialog.querySelector<HTMLElement>(
		"#background-video-name",
	)!;
	const layer = backdrop.querySelector<HTMLElement>(".wallpaper-layer")!;
	let settings = { ...DEFAULT_BACKGROUND };
	try {
		settings = readBackground(localStorage);
	} catch {}
	let photo: BackgroundPhoto | undefined;
	let photoUrl = "";
	let photoVersion = 0;
	let photoLoad: Promise<void> | undefined;
	let localVideo: BackgroundLocalVideo | undefined;
	let localUrl = "";
	let localPoster = "";
	let videoLoad: Promise<void> | undefined;
	let sessionVideo = false;
	let busy = false;
	let sessionPhoto = false;
	let returnFocus: HTMLElement = opener;
	const say = (message: string) => {
		status.textContent = message;
	};
	let effectivePaused = true;
	const movie = backgroundVideos[0];
	const player = createBackgroundVideo(
		video,
		movie.src,
		(paused) => {
			effectivePaused = paused;
			playback.textContent = paused ? "播放动态壁纸" : "暂停动态壁纸";
		},
		say,
	);
	function setPhoto(value: BackgroundPhoto | undefined, url = "") {
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photo = value;
		photoUrl = url;
		photoName.textContent = photo ? photo.name.slice(0, 160) : "尚未选择图片";
	}
	function setLocalVideo(value?: BackgroundLocalVideo) {
		if (localUrl && video.getAttribute("src") === localUrl)
			player.sync(false, true);
		if (localUrl) URL.revokeObjectURL(localUrl);
		if (localPoster) URL.revokeObjectURL(localPoster);
		localVideo = value;
		localUrl = value ? URL.createObjectURL(value.blob) : "";
		localPoster = value ? URL.createObjectURL(value.poster) : "";
		videoName.textContent = value ? value.name.slice(0, 160) : "尚未选择视频";
	}
	const videoSource = () => (settings.video === "local" ? localUrl : movie.src);
	function render(syncVideo = true) {
		const builtin = backgroundImages.find(
			(image) => image.id === settings.wallpaper,
		);
		const active = settings.mode !== "image" || !!builtin || !!photoUrl;
		backdrop!.hidden = !active;
		document.documentElement.classList.toggle("has-custom-background", active);
		backdrop!.style.setProperty(
			"--wallpaper-mask",
			String(settings.overlay / 100),
		);
		layer.style.filter =
			settings.mode !== "color" ? `blur(${settings.blur}px)` : "none";
		layer.style.backgroundImage = "none";
		layer.style.backgroundColor = "transparent";
		if (settings.mode === "image" && (builtin || photoUrl))
			layer.style.backgroundImage = `url(${JSON.stringify(builtin?.src || photoUrl)})`;
		const poster = settings.video === "local" ? localPoster : movie.poster;
		if (settings.mode === "video" && poster)
			layer.style.backgroundImage = `url(${JSON.stringify(poster)})`;
		if (settings.mode === "color") layer.style.backgroundColor = settings.color;
		if (poster) video.poster = poster;
		else video.removeAttribute("poster");
		useLocal.hidden =
			!localVideo || (settings.mode === "video" && settings.video === "local");
		removeLocal.disabled = !localVideo || busy;
		playback.hidden = settings.mode !== "video";
		playback.disabled = busy || !videoSource();
		if (localVideo)
			videoName.textContent =
				localVideo.name.slice(0, 160) + (sessionVideo ? "（仅本次页面）" : "");
		for (const button of videoButtons)
			button.setAttribute(
				"aria-pressed",
				String(
					settings.mode === "video" &&
						button.dataset.videoWallpaper === settings.video,
				),
			);
		if (syncVideo)
			player.sync(
				settings.mode === "video" && !!videoSource(),
				settings.videoPaused,
				false,
				videoSource(),
			);
		for (const section of dialog!.querySelectorAll<HTMLElement>(
			"[data-background-section]",
		))
			section.hidden = !section.dataset
				.backgroundSection!.split(" ")
				.includes(settings.mode);
		for (const radio of radios) radio.checked = radio.value === settings.mode;
		for (const button of builtinButtons)
			button.setAttribute(
				"aria-pressed",
				String(
					settings.mode === "image" &&
						button.dataset.wallpaper === settings.wallpaper,
				),
			);
		usePhoto.hidden =
			!photo || (settings.mode === "image" && !settings.wallpaper);
		color.value = settings.color;
		dialog!.querySelector("#background-color-value")!.textContent =
			settings.color;
		overlay.value = String(settings.overlay);
		blur.value = String(settings.blur);
		dialog!.querySelector("#background-overlay-value")!.textContent =
			settings.overlay + "%";
		dialog!.querySelector("#background-blur-value")!.textContent =
			settings.blur + " px";
		overlay.disabled = false;
		blur.disabled =
			settings.mode === "color" ||
			(settings.mode === "image" && !builtin && !photo);
		remove.disabled = !photo || busy;
	}
	function persist() {
		const value =
			sessionVideo && settings.mode === "video" && settings.video === "local"
				? { ...settings, video: "luo-xiaohei" as const }
				: sessionPhoto && settings.mode === "image" && !settings.wallpaper
					? {
							...settings,
							mode: "image" as const,
							wallpaper: DEFAULT_BACKGROUND.wallpaper,
						}
					: settings;
		let saved = false;
		try {
			saved = saveBackground(localStorage, value);
		} catch {}
		say(
			sessionVideo && settings.mode === "video" && settings.video === "local"
				? "已应用到当前页面，浏览器无法保存此视频，刷新后恢复罗小黑壁纸。"
				: sessionPhoto && settings.mode === "image" && !settings.wallpaper
					? "已应用到当前页面，浏览器无法保存这张图片。"
					: saved
						? "已保存到此浏览器。"
						: "当前页面已应用，浏览器不允许保存设置。",
		);
	}
	function setBusy(value: boolean) {
		busy = value;
		fields.disabled = value;
		dialog!.setAttribute("aria-busy", String(value));
		render(false);
	}
	async function decodedUrl(value: BackgroundPhoto) {
		const url = URL.createObjectURL(value.blob);
		try {
			const image = new Image();
			image.src = url;
			await image.decode();
			if (
				!image.naturalWidth ||
				image.naturalWidth * image.naturalHeight > 32000000
			)
				throw new Error("image dimensions");
			return url;
		} catch (error) {
			URL.revokeObjectURL(url);
			throw error;
		}
	}
	async function loadPhoto() {
		if (photoLoad || photo) return photoLoad;
		const version = photoVersion;
		photoLoad = (async () => {
			try {
				const saved = await readPhoto();
				if (version !== photoVersion) return;
				if (saved) {
					const url = await decodedUrl(saved);
					if (version !== photoVersion) {
						URL.revokeObjectURL(url);
						return;
					}
					setPhoto(saved, url);
					render();
				} else if (settings.mode === "image" && !settings.wallpaper) {
					settings.mode = "image";
					settings.wallpaper = DEFAULT_BACKGROUND.wallpaper;
					render();
					persist();
					say("原背景图片已不可用，已切换为云下小憩。");
				}
			} catch {
				if (
					version === photoVersion &&
					settings.mode === "image" &&
					!settings.wallpaper
				) {
					settings.mode = "image";
					settings.wallpaper = DEFAULT_BACKGROUND.wallpaper;
					render();
					say("无法读取背景图片，暂时显示云下小憩。");
				}
			}
		})().finally(() => {
			photoLoad = undefined;
		});
		return photoLoad;
	}
	async function loadLocalVideo() {
		if (videoLoad || localVideo) return videoLoad;
		videoLoad = (async () => {
			try {
				const value = await readLocalVideo();
				if (value) setLocalVideo(value);
				else if (settings.mode === "video" && settings.video === "local") {
					settings.video = "luo-xiaohei";
					persist();
					say("本地视频已不可用，已恢复罗小黑动态壁纸。");
				}
			} catch {
				if (settings.mode === "video" && settings.video === "local") {
					settings.video = "luo-xiaohei";
					persist();
					say("暂时无法读取本地视频，已恢复罗小黑动态壁纸。");
				}
			}
			render();
		})().finally(() => {
			videoLoad = undefined;
		});
		return videoLoad;
	}
	opener.addEventListener("click", () => {
		returnFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: opener;
		const search = document.querySelector<HTMLDialogElement>("#search-dialog");
		if (search?.open) search.close();
		document.querySelector<HTMLDialogElement>("#mobile-navigation")?.close();
		const music = document.querySelector<HTMLElement>("#music-panel");
		if (music?.matches(":popover-open")) music.hidePopover();
		dialog.showModal();
		void loadPhoto();
		void loadLocalVideo();
	});
	dialog
		.querySelector("#close-appearance")!
		.addEventListener("click", () => dialog.close());
	dialog.addEventListener("close", () => {
		(returnFocus.isConnected ? returnFocus : opener).focus();
	});
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) {
			const rect = dialog.getBoundingClientRect();
			if (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			)
				dialog.close();
		}
	});
	dialog
		.querySelector("form")!
		.addEventListener("submit", (event) => event.preventDefault());
	for (const radio of radios)
		radio.addEventListener("change", () => {
			if (busy) return;
			if (radio.value === "video") {
				if (settings.video === "local" && localVideo) selectLocalVideo();
				else selectVideo();
				return;
			}
			if (radio.value === "image" && settings.wallpaper) {
				void selectBuiltin(settings.wallpaper);
				return;
			}
			settings.mode = radio.value as BackgroundMode;
			render();
			persist();
			if (settings.mode === "image" && !settings.wallpaper && !photo) {
				say("选择一张本地图片后即可显示背景。");
				void loadPhoto();
			}
		});
	color.addEventListener("input", () => {
		if (busy) return;
		settings = { ...settings, mode: "color", color: color.value };
		render();
		persist();
	});
	overlay.addEventListener("input", () => {
		if (busy) return;
		settings.overlay = Number(overlay.value);
		render();
		persist();
	});
	blur.addEventListener("input", () => {
		if (busy) return;
		settings.blur = Number(blur.value);
		render();
		persist();
	});
	async function selectBuiltin(id: BackgroundImageId, restoring = false) {
		if (busy) return;
		const chosen = backgroundImages.find((image) => image.id === id);
		if (!chosen) return;
		setBusy(true);
		say("正在加载背景图片…");
		try {
			const image = new Image();
			image.src = chosen.src;
			await image.decode();
			++photoVersion;
			settings.mode = "image";
			settings.wallpaper = chosen.id;
			render();
			if (!restoring) persist();
			else say("已恢复保存的背景。");
		} catch {
			if (restoring) {
				settings.mode = "color";
				render();
				say("原背景图片暂时无法加载，当前使用纯色背景。");
			} else say("这张背景图片暂时无法加载，请换一张试试。");
		} finally {
			setBusy(false);
		}
	}
	for (const button of builtinButtons)
		button.addEventListener("click", () => {
			const chosen = backgroundImages.find(
				(image) => image.id === button.dataset.wallpaper,
			);
			if (chosen) void selectBuiltin(chosen.id);
		});
	function selectVideo() {
		if (busy) return;
		++photoVersion;
		settings.mode = "video";
		settings.video = "luo-xiaohei";
		settings.videoPaused = false;
		persist();
		render();
		player.sync(true, false, true, movie.src);
	}
	for (const button of videoButtons)
		button.addEventListener("click", selectVideo);
	playback.addEventListener("click", () => {
		if (busy || settings.mode !== "video") return;
		settings.videoPaused = !effectivePaused;
		persist();
		player.sync(true, settings.videoPaused, true, videoSource());
	});
	function selectLocalVideo() {
		if (busy || !localVideo) return;
		settings.mode = "video";
		settings.video = "local";
		settings.videoPaused = false;
		persist();
		render();
		player.sync(true, false, true, localUrl);
	}
	useLocal.addEventListener("click", selectLocalVideo);
	dialog
		.querySelector("#choose-background-video")!
		.addEventListener("click", () => videoFile.click());
	videoFile.addEventListener("change", async () => {
		const selected = videoFile.files?.[0];
		videoFile.value = "";
		if (!selected || busy) return;
		if (
			selected.type !== "video/mp4" &&
			!(selected.type === "" && /\.mp4$/i.test(selected.name))
		) {
			say("请选择 MP4 视频文件。");
			return;
		}
		if (!selected.size || selected.size > MAX_BACKGROUND_VIDEO_BYTES) {
			say("请选择不超过 100 MB 的 MP4 视频。");
			return;
		}
		setBusy(true);
		say("正在读取并保存本地视频…");
		let applied = false;
		try {
			await videoLoad;
			const blob = selected.type
				? selected
				: new Blob([selected], { type: "video/mp4" });
			const value = await prepareLocalVideo(blob, selected.name);
			try {
				await storeLocalVideo(value);
				sessionVideo = false;
			} catch {
				sessionVideo = true;
			}
			setLocalVideo(value);
			settings.mode = "video";
			settings.video = "local";
			settings.videoPaused = false;
			applied = true;
			render();
			persist();
		} catch (error) {
			say(
				error instanceof Error
					? error.message
					: "无法读取此视频，原背景已保留。",
			);
		} finally {
			setBusy(false);
		}
		if (
			applied &&
			settings.mode === "video" &&
			settings.video === "local" &&
			localVideo
		)
			player.sync(true, settings.videoPaused, true, localUrl);
	});
	removeLocal.addEventListener("click", async () => {
		if (busy) return;
		setBusy(true);
		try {
			await videoLoad;
			await deleteLocalVideo();
			setLocalVideo();
			sessionVideo = false;
			if (settings.video === "local") settings.video = "luo-xiaohei";
			render();
			persist();
			say("已删除此浏览器保存的本地视频。");
		} catch {
			say("暂时无法删除视频，请稍后再试。");
		} finally {
			setBusy(false);
		}
	});
	usePhoto.addEventListener("click", () => {
		if (busy || !photo) return;
		settings.mode = "image";
		delete settings.wallpaper;
		render();
		persist();
	});
	dialog
		.querySelector("#choose-background-photo")!
		.addEventListener("click", () => file.click());
	file.addEventListener("change", async () => {
		const selected = file.files?.[0];
		file.value = "";
		if (!selected || busy) return;
		if (!isBackgroundPhotoType(selected.type)) {
			say("请选择 GIF、APNG、WebP、JPG、PNG 或 AVIF 图片。");
			return;
		}
		if (!selected.size || selected.size > MAX_BACKGROUND_BYTES) {
			say("请选择不超过 10 MB 的图片。");
			return;
		}
		++photoVersion;
		setBusy(true);
		say("正在保存本地图片…");
		let url = "";
		try {
			const value = { blob: selected, name: selected.name };
			url = await decodedUrl(value);
			try {
				await storePhoto(value);
				sessionPhoto = false;
			} catch {
				sessionPhoto = true;
			}
			setPhoto(value, url);
			url = "";
			settings.mode = "image";
			delete settings.wallpaper;
			render();
			persist();
		} catch {
			if (url) URL.revokeObjectURL(url);
			say("这张图片无法读取，请换一张常见格式的图片。");
		} finally {
			setBusy(false);
		}
	});
	remove.addEventListener("click", async () => {
		if (busy) return;
		++photoVersion;
		setBusy(true);
		try {
			await deletePhoto();
			setPhoto(undefined);
			sessionPhoto = false;
			if (settings.mode === "image" && !settings.wallpaper)
				settings.wallpaper = DEFAULT_BACKGROUND.wallpaper;
			render();
			persist();
			say("已删除此浏览器保存的背景图片。");
		} catch {
			say("暂时无法删除图片，请稍后再试。");
		} finally {
			setBusy(false);
		}
	});
	dialog
		.querySelector("#reset-background")!
		.addEventListener("click", async () => {
			if (busy) return;
			++photoVersion;
			setBusy(true);
			await videoLoad;
			settings = { ...DEFAULT_BACKGROUND };
			setLocalVideo();
			sessionVideo = false;
			setPhoto(undefined);
			sessionPhoto = false;
			render();
			let preferencesCleared = true;
			try {
				localStorage.removeItem(BACKGROUND_KEY);
			} catch {
				preferencesCleared = false;
			}
			let photoCleared = true;
			try {
				await deletePhoto();
				await deleteLocalVideo();
			} catch {
				photoCleared = false;
			}
			setBusy(false);
			say(
				!preferencesCleared
					? "当前页面已重置，浏览器未能清除原设置。"
					: !photoCleared
						? "已重置背景，本地图片或视频缓存暂时未能清除。"
						: "已恢复云下小憩静态壁纸。",
			);
		});
	window.addEventListener("pagehide", (event) => {
		if (!event.persisted) {
			if (photoUrl) URL.revokeObjectURL(photoUrl);
			if (localUrl) URL.revokeObjectURL(localUrl);
			if (localPoster) URL.revokeObjectURL(localPoster);
		}
	});
	render();
	if (settings.mode === "video" && settings.video === "local")
		void loadLocalVideo();
	if (settings.mode === "image") {
		if (settings.wallpaper) void selectBuiltin(settings.wallpaper, true);
		else void loadPhoto();
	}
}
