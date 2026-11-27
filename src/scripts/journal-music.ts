import {
	activeLyricIndex,
	isInlineLrc,
	type LyricLine,
	loadMetingPlaylist,
	type MusicServer,
	musicAudioSources,
	officialMusicPage,
	parseLrc,
	parsePlaylistInput,
	type MusicTrack as Track,
} from "./music-sources";

type SavedMusic = {
	index?: number;
	time?: number;
	volume?: number;
	repeat?: boolean;
	shuffle?: boolean;
	muted?: boolean;
	url?: string;
	floatingLyrics?: boolean;
	bottomLyricsVisible?: boolean;
	bottomLyricsOptIn?: boolean;
	petLyricsVisible?: boolean;
};

const controllers = new WeakMap<HTMLElement, () => void>();
const initializedWidgets = new WeakSet<HTMLElement>();
type WidgetView = {
	tracks?: Track[];
	rows: { button: HTMLButtonElement; track: Track }[];
	lyrics?: LyricLine[];
	lyricRows: HTMLButtonElement[];
	active: number;
};
const widgetViews = new WeakMap<HTMLElement, WidgetView>();

export function initializeJournalMusic() {
	const foundPanel = document.querySelector<HTMLElement>("#music-panel");
	const foundAudio = document.querySelector<HTMLAudioElement>("#journal-audio");
	const foundConfig = document.querySelector<HTMLElement>("#music-config");
	if (!foundPanel || !foundAudio || !foundConfig) return;
	const panel = foundPanel;
	const update = controllers.get(panel);
	if (update) {
		update();
		return;
	}
	let embedded = panel.dataset.mode === "page";
	const audio = foundAudio;
	const config = foundConfig;
	panel.dataset.initialized = "true";
	let tracks: Track[] = JSON.parse(config.dataset.tracks || "[]");
	if (!tracks.length) return;
	const curatedTracks = tracks;
	let sourceKind: "curated" | "online" = "curated";
	let sourceView: "curated" | "online" = "curated";
	let sourceRequest: AbortController | undefined;
	let lyricRequest: AbortController | undefined;
	let lyrics: LyricLine[] = [];
	let lyricButtons: HTMLButtonElement[] = [];
	let lyricIndex = -2;
	let followLyrics = true;
	const failedTracks = new Set<Track>();
	let trackRows: {
		track: Track;
		row: HTMLLIElement;
		button: HTMLButtonElement;
		badge: HTMLElement;
	}[] = [];
	let lyricTrack: Track | undefined;
	let assetTrack: Track | undefined;
	let audioSourceIndex = 0;
	const find = <T extends HTMLElement>(selector: string) => {
		const element = document.querySelector<T>(selector);
		if (!element) throw new Error(`Missing music control: ${selector}`);
		return element;
	};
	const opener = find<HTMLButtonElement>("#open-music");
	const seek = find<HTMLInputElement>("#music-seek");
	const volume = find<HTMLInputElement>("#music-volume");
	const repeat = find<HTMLButtonElement>("[data-music-repeat]");
	const mute = find<HTMLButtonElement>("[data-music-mute]");
	const quickVolume = find<HTMLInputElement>("[data-music-quick-volume]");
	const quickMute = find<HTMLButtonElement>("[data-music-quick-mute]");
	const queueToggle = find<HTMLButtonElement>("[data-music-queue-toggle]");
	const lyricsToggle = find<HTMLButtonElement>("[data-music-lyrics-toggle]");
	const status = find<HTMLElement>("[data-music-status]");
	const sourceStatus = find<HTMLElement>("[data-music-source-status]");
	const onlineForm = find<HTMLFormElement>("#music-online-form");
	const playlistInput = find<HTMLInputElement>("#music-playlist-input");
	const platformInput = find<HTMLSelectElement>("[data-music-platform]");
	const playlist = find<HTMLOListElement>(".music-track-list");
	const cover = find<HTMLImageElement>("[data-music-cover]");
	const lyricList = find<HTMLOListElement>("[data-music-lyric-lines]");
	const lyricStatus = find<HTMLElement>("[data-music-lyric-status]");
	const lyricPreview = find<HTMLElement>("[data-music-lyric-preview]");
	const sourceLink = find<HTMLAnchorElement>("[data-music-source-link]");
	const lyricStrip = find<HTMLElement>("#music-lyric-strip");
	const trackSearch = find<HTMLInputElement>("#music-track-search");
	const followButton = find<HTMLButtonElement>("[data-music-lyric-follow]");
	const floatingToggle = find<HTMLButtonElement>(
		"[data-music-floating-toggle]",
	);
	const officialLink = find<HTMLAnchorElement>("[data-music-official]");
	const curatedSource = {
		href:
			sourceLink.getAttribute("href") ||
			"https://music.163.com/playlist?id=18638530828",
		title: sourceLink.textContent || "我的网易云歌单",
	};
	const toggles = [
		find<HTMLButtonElement>("[data-music-toggle]"),
		find<HTMLButtonElement>('[data-pet-action="toggle"]'),
	];
	opener.addEventListener("click", () => {
		if (!embedded) return;
		panel.scrollIntoView({ block: "center" });
		toggles[0]?.focus({ preventScroll: true });
	});
	const storageKey = "anxiu-journal-music-v1";
	let saved: SavedMusic = {};
	try {
		saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}") || {};
	} catch {
		/* Storage is optional. */
	}
	const savedIndex = saved.index;
	let index =
		typeof savedIndex === "number" &&
		Number.isInteger(savedIndex) &&
		savedIndex >= 0 &&
		savedIndex < tracks.length &&
		(!saved.url || saved.url === tracks[savedIndex].url)
			? savedIndex
			: 0;
	let resumeTime =
		(!saved.url || saved.url === tracks[index].url) &&
		typeof saved.time === "number" &&
		Number.isFinite(saved.time)
			? Math.max(0, saved.time)
			: 0;
	let repeatOne = saved.repeat === true;
	let shuffle = !repeatOne && saved.shuffle === true;
	const autoplayEnabled = config.dataset.autoPlay === "true";
	let autoplayPending = autoplayEnabled;
	let autoplayWaiting = false;
	let intent = false;
	let version = 0;
	let lastSave = 0;
	let showDock = false;
	// Older versions saved default-on as a preference. Require the new explicit opt-in.
	let floatingLyrics =
		saved.bottomLyricsOptIn === true && saved.bottomLyricsVisible === true;
	let petLyricsVisible = saved.petLyricsVisible === true;
	let slowTimer: ReturnType<typeof setTimeout> | undefined;
	audio.volume =
		typeof saved.volume === "number" && Number.isFinite(saved.volume)
			? Math.max(0, Math.min(1, saved.volume))
			: 0.35;
	audio.muted = saved.muted === true;

	const formatTime = (value: number) => {
		const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	};
	function save() {
		try {
			sessionStorage.setItem(
				storageKey,
				JSON.stringify({
					index,
					url: tracks[index].url,
					time: audio.readyState >= 1 ? audio.currentTime : resumeTime,
					volume: audio.volume,
					repeat: repeatOne,
					shuffle,
					muted: audio.muted,
					floatingLyrics,
					bottomLyricsVisible: floatingLyrics,
					bottomLyricsOptIn: true,
					petLyricsVisible,
				}),
			);
		} catch {
			/* Private mode must still allow playback. */
		}
	}
	function message(text: string, error = false) {
		status.textContent = text;
		status.dataset.error = String(error);
		find("[data-music-recovery]").hidden = !error;
	}
	function renderProgress() {
		const duration = audio.duration;
		const time = audio.readyState >= 1 ? audio.currentTime : resumeTime;
		seek.disabled = !Number.isFinite(duration) || duration <= 0;
		seek.value = seek.disabled
			? "0"
			: String(Math.round((time / duration) * 1000));
		seek.setAttribute(
			"aria-valuetext",
			`${formatTime(time)} / ${formatTime(duration)}`,
		);
		find("[data-music-elapsed]").textContent = formatTime(time);
		find("[data-music-duration]").textContent = formatTime(duration);
		panel.style?.setProperty("--music-progress", `${Number(seek.value) / 10}%`);
		renderLyric(time);
		renderFloating();
	}
	function renderVolume() {
		volume.value = String(Math.round(audio.volume * 100));
		find("[data-music-volume]").textContent = audio.muted
			? "静音"
			: `${volume.value}%`;
		const silent = audio.muted || audio.volume === 0;
		mute.setAttribute("aria-label", silent ? "取消静音" : "静音");
		mute.setAttribute("aria-pressed", String(silent));
		find("[data-volume-on]").hidden = silent;
		find("[data-volume-off]").hidden = !silent;
		quickVolume.value = silent ? "0" : volume.value;
		quickMute.setAttribute("aria-label", silent ? "取消静音" : "静音");
		quickMute.setAttribute("aria-pressed", String(silent));
		find("[data-quick-volume-on]").hidden = silent;
		find("[data-quick-volume-off]").hidden = !silent;
		panel.style?.setProperty("--music-volume", `${quickVolume.value}%`);
		renderWidget();
	}
	function renderPlayback() {
		const playing = !audio.paused && !audio.ended && !audio.error;
		panel.dataset.playing = String(playing);
		opener.classList.toggle("is-playing", playing);
		opener.setAttribute(
			"aria-label",
			embedded
				? playing
					? "音乐正在播放，前往播放区"
					: "前往音乐播放区"
				: playing
					? "打开音乐播放器，正在播放"
					: "打开音乐播放器",
		);
		for (const button of toggles) {
			button.setAttribute("aria-label", intent ? "暂停音乐" : "播放音乐");
			const playIcon = button.querySelector<HTMLElement>(".music-play-icon");
			const pauseIcon = button.querySelector<HTMLElement>(".music-pause-icon");
			if (playIcon) playIcon.hidden = intent;
			if (pauseIcon) pauseIcon.hidden = !intent;
		}
		renderAvailability();
		renderFloating();
	}
	function renderRepeat() {
		repeat.setAttribute("aria-pressed", String(repeatOne || shuffle));
		repeat.setAttribute(
			"aria-label",
			repeatOne
				? "切换为随机播放"
				: shuffle
					? "切换为列表循环"
					: "切换为单曲循环",
		);
		const mode = repeatOne ? "one" : shuffle ? "shuffle" : "list";
		repeat.dataset.mode = mode;
		for (const value of ["list", "one", "shuffle"]) {
			const icon = repeat.querySelector<HTMLElement>(
				`[data-music-mode-icon="${value}"]`,
			);
			if (icon) icon.hidden = value !== mode;
		}
		const label = repeat.querySelector("[data-music-mode-label]");
		if (label)
			label.textContent = repeatOne
				? "单曲循环"
				: shuffle
					? "随机播放"
					: "列表循环";
		renderWidget();
	}
	function cyclePlayMode() {
		if (repeatOne) {
			repeatOne = false;
			shuffle = true;
		} else if (shuffle) shuffle = false;
		else repeatOne = true;
		renderRepeat();
		save();
	}
	function nextIndex() {
		return shuffle && tracks.length > 1
			? (index + 1 + Math.floor(Math.random() * (tracks.length - 1))) %
					tracks.length
			: index + 1;
	}
	function renderFloating() {
		const hidden = !floatingLyrics || !showDock || lyrics.length === 0;
		lyricStrip.hidden = hidden;
		find("#journal-player").dataset.floatingLyrics = String(!hidden);
		const time = audio.readyState >= 1 ? audio.currentTime : resumeTime;
		const active = activeLyricIndex(lyrics, time);
		const line = lyrics[Math.max(0, active)];
		const current = find<HTMLElement>("[data-floating-current]");
		const text = line?.text || lyricPreview.textContent || "等待歌词";
		const changed = current.dataset.lyric !== text;
		current.textContent = text;
		current.dataset.lyric = text;
		find("[data-floating-next]").textContent =
			lyrics[Math.max(0, active) + 1]?.text || "";
		const end = lyrics[active + 1]?.time ?? audio.duration;
		const span = line ? end - line.time : 0;
		const fraction =
			active >= 0 && Number.isFinite(span) && span > 0 && line
				? Math.max(0, Math.min(1, (time - line.time) / span))
				: 0;
		const progress = String(Math.round(fraction * 10000) / 100);
		lyricStrip.dataset.progress = progress;
		lyricStrip.dataset.playing = String(intent && !audio.paused);
		lyricStrip.style?.setProperty("--lyric-fill", `${progress}%`);
		lyricStrip.style?.setProperty(
			"--lyric-fill-duration",
			changed || audio.paused ? "0s" : ".18s",
		);
		floatingToggle.setAttribute("aria-pressed", String(floatingLyrics));
		floatingToggle.textContent = floatingLyrics
			? "隐藏底部歌词"
			: "显示底部歌词";
		find("[data-music-lyrics-panel]").hidden = false;
		renderPet();
		renderWidget();
	}

	function renderPet() {
		const pet = find<HTMLElement>("[data-music-pet]");
		pet.dataset.playing = String(!audio.paused && !audio.ended && !audio.error);
		const handle = find<HTMLElement>("[data-pet-drag-handle]");
		handle.setAttribute("aria-pressed", pet.dataset.playing);
		handle.setAttribute(
			"aria-label",
			(pet.dataset.playing === "true" ? "暂停音乐" : "播放音乐") +
				"；拖动可移动罗小黑",
		);
		pet.dataset.waiting = String(panel.dataset.autoplay === "waiting");
		pet.dataset.error = String(status.dataset.error === "true");
		find("[data-pet-title]").textContent = tracks[index].title;
		find("[data-pet-title]").setAttribute(
			"title",
			`${tracks[index].title} · ${tracks[index].artist}`,
		);
		const time = audio.readyState >= 1 ? audio.currentTime : resumeTime;
		const active = activeLyricIndex(lyrics, time);
		const currentText = active >= 0 ? lyrics[active]?.text || "" : "";
		find("[data-pet-current]").textContent = currentText;
		const nextLine = find<HTMLElement>("[data-pet-next]");
		nextLine.textContent = currentText ? lyrics[active + 1]?.text || "" : "";
		nextLine.hidden = !nextLine.textContent;
		const line = find<HTMLElement>("[data-pet-lyrics]");
		line.hidden = !petLyricsVisible || !currentText.trim();
		line.style?.setProperty("--lyric-fill", `${lyricStrip.dataset.progress}%`);
		find("[data-pet-current]").dataset.lyric =
			find("[data-pet-current]").textContent || "";
		const lyricButton = find<HTMLButtonElement>('[data-pet-action="lyrics"]');
		lyricButton.setAttribute("aria-pressed", String(petLyricsVisible));
		lyricButton.setAttribute(
			"aria-label",
			petLyricsVisible ? "隐藏宠物下方歌词" : "显示宠物下方歌词",
		);
		find("[data-pet-status]").textContent =
			status.dataset.error === "true"
				? "播放遇到问题，可重试或切歌"
				: panel.dataset.autoplay === "waiting"
					? "点击播放，让小黑陪你听歌"
					: "";
	}
	function openPlayer() {
		if (embedded) panel.scrollIntoView({ block: "start" });
		else panel.showPopover();
		renderPlayback();
		toggles[0].focus({ preventScroll: true });
	}
	function setLyricPlacement(bottom: boolean) {
		floatingLyrics = bottom;
		renderFloating();
		save();
	}
	function renderWidget() {
		const widget = document.querySelector<HTMLElement>("[data-music-widget]");
		if (!widget) return;
		const get = <T extends HTMLElement>(selector: string) =>
			widget.querySelector<T>(selector);
		const text = (selector: string, value: string) => {
			const node = get(selector);
			if (node) node.textContent = value;
		};
		widget.dataset.playing = String(!audio.paused && intent && !audio.error);
		widget.dataset.autoplay = panel.dataset.autoplay || "disabled";
		widget.dataset.error = String(
			!!audio.error || status.dataset.error === "true",
		);
		const artwork = get<HTMLImageElement>("[data-widget-cover]");
		if (artwork) {
			const src = cover.hidden ? null : cover.getAttribute("src");
			artwork.hidden = !src;
			if (src) {
				if (artwork.getAttribute("src") !== src)
					artwork.setAttribute("src", src);
			} else artwork.removeAttribute("src");
		}

		text("[data-widget-title]", tracks[index].title);
		text("[data-widget-artist]", tracks[index].artist);
		text(
			"[data-sidebar-music-state]",
			autoplayWaiting
				? "点击页面后开始播放"
				: audio.error || status.dataset.error === "true"
					? status.textContent || "暂时无法播放 · 可重试"
					: intent
						? audio.paused
							? "正在加载"
							: "正在播放"
						: showDock
							? "已暂停"
							: "点击播放，陪你读一会儿。",
		);
		text(
			"[data-widget-current]",
			find("[data-floating-current]").textContent || "播放后显示同步歌词",
		);
		text("[data-widget-next]", find("[data-floating-next]").textContent || "");
		const widgetSeek = get<HTMLInputElement>("[data-widget-seek]");
		if (widgetSeek) {
			widgetSeek.value = seek.value;
			widgetSeek.disabled = seek.disabled;
			widgetSeek.setAttribute(
				"aria-valuetext",
				seek.getAttribute("aria-valuetext") || "0:00 / 0:00",
			);
		}
		text(
			"[data-widget-elapsed]",
			formatTime(audio.readyState >= 1 ? audio.currentTime : resumeTime),
		);
		text("[data-widget-duration]", formatTime(audio.duration));
		const volumeInput = get<HTMLInputElement>("[data-widget-volume]");
		const silent = audio.muted || audio.volume === 0;
		if (volumeInput)
			volumeInput.value = String(Math.round(silent ? 0 : audio.volume * 100));
		widget.style?.setProperty(
			"--ff-volume",
			`${String(silent ? 0 : audio.volume * 100)}%`,
		);
		widget.style?.setProperty(
			"--ff-progress",
			`${String(Number(seek.value) / 10)}%`,
		);
		get('[data-widget-action="mute"]')?.setAttribute(
			"aria-pressed",
			String(silent),
		);
		get('[data-widget-action="mute"]')?.setAttribute(
			"aria-label",
			silent ? "取消静音" : "静音",
		);
		const volOn = get("[data-widget-volume-on]");
		const volOff = get("[data-widget-volume-off]");
		if (volOn) volOn.hidden = silent;
		if (volOff) volOff.hidden = !silent;
		const mode = repeatOne ? "one" : shuffle ? "shuffle" : "list";
		const modeButton = get('[data-widget-action="repeat"]');
		if (modeButton) {
			modeButton.dataset.mode = mode;
			modeButton.setAttribute(
				"aria-label",
				repeat.getAttribute("aria-label") || "切换为单曲循环",
			);
		}
		for (const name of ["list", "one", "shuffle"]) {
			const icon = get(`[data-widget-repeat-${name}]`);
			if (icon) icon.hidden = name !== mode;
		}
		renderWidgetDrawers(widget);
		const toggle = get<HTMLButtonElement>('[data-widget-action="toggle"]');
		if (toggle) {
			toggle.setAttribute("aria-label", intent ? "暂停音乐" : "播放音乐");
			const playIcon = toggle.querySelector<HTMLElement>(".music-play-icon");
			const pauseIcon = toggle.querySelector<HTMLElement>(".music-pause-icon");
			if (playIcon) playIcon.hidden = intent;
			if (pauseIcon) pauseIcon.hidden = !intent;
		}
		if (initializedWidgets.has(widget)) return;
		initializedWidgets.add(widget);
		widgetSeek?.addEventListener("input", () => seekTo(widgetSeek.value));
		volumeInput?.addEventListener("input", () => setVolume(volumeInput.value));
		get("[data-widget-lyric-lines]")?.addEventListener(
			"wheel",
			() => {
				widget.dataset.browseUntil = String(Date.now() + 5000);
			},
			{ passive: true },
		);
		get("[data-widget-lyric-lines]")?.addEventListener(
			"touchstart",
			() => {
				widget.dataset.browseUntil = String(Date.now() + 5000);
			},
			{ passive: true },
		);
		const actions: Record<string, () => void> = {
			toggle: () => {
				if (intent) pause();
				else void play();
			},
			prev: () => selectTrack(index - 1),
			next: () => selectTrack(nextIndex()),
			repeat: cyclePlayMode,
			mute: toggleMute,
			list: () => {
				widget.dataset.drawer =
					widget.dataset.drawer === "list" ? "none" : "list";
				renderWidget();
			},
			"local-lyrics": () => {
				widget.dataset.drawer =
					widget.dataset.drawer === "lyrics" ? "none" : "lyrics";
				renderWidget();
			},
			open: () => {
				openPlayer();
				find<HTMLDetailsElement>("[data-music-queue-panel]").open = true;
			},
		};
		for (const [name, handler] of Object.entries(actions))
			get<HTMLButtonElement>(
				`[data-widget-action="${name}"]`,
			)?.addEventListener("click", handler);
	}
	function renderWidgetDrawers(widget: HTMLElement) {
		let state = widgetViews.get(widget);
		if (!state) {
			state = { rows: [], lyricRows: [], active: -2 };
			widgetViews.set(widget, state);
		}
		const list = widget.querySelector<HTMLOListElement>(
			"[data-widget-playlist]",
		);
		const lines = widget.querySelector<HTMLOListElement>(
			"[data-widget-lyric-lines]",
		);
		const lyricDrawer = widget.querySelector<HTMLElement>(
			"[data-widget-lyrics]",
		);
		const listDrawer = widget.querySelector<HTMLElement>(
			"[data-widget-list-drawer]",
		);
		const listOpen = widget.dataset.drawer === "list";
		const lyricsOpen = widget.dataset.drawer === "lyrics";
		if (lyricDrawer) lyricDrawer.hidden = !lyricsOpen;
		if (listDrawer) listDrawer.hidden = !listOpen;
		if (list) list.hidden = !listOpen;
		widget
			.querySelector('[data-widget-action="list"]')
			?.setAttribute("aria-expanded", String(listOpen));
		widget
			.querySelector('[data-widget-action="local-lyrics"]')
			?.setAttribute("aria-expanded", String(lyricsOpen));
		const lrcOn = widget.querySelector<HTMLElement>("[data-widget-lyric-on]");
		const lrcOff = widget.querySelector<HTMLElement>("[data-widget-lyric-off]");
		if (lrcOn) lrcOn.hidden = !lyricsOpen;
		if (lrcOff) lrcOff.hidden = lyricsOpen;
		const count = widget.querySelector("[data-widget-count]");
		if (count) count.textContent = `${String(tracks.length)} 首`;
		if (list && listOpen && state.tracks !== tracks) {
			state.tracks = tracks;
			state.rows = [];
			list.replaceChildren();
			tracks.forEach((track, i) => {
				const li = document.createElement("li");
				const button = document.createElement("button");
				const art = document.createElement("span");
				const text = document.createElement("span");
				const title = document.createElement("strong");
				const artist = document.createElement("small");
				button.type = "button";
				art.className = "ff-list-art";
				text.className = "ff-list-text";
				if (track.cover) {
					const img = document.createElement("img");
					img.src = track.cover;
					img.alt = "";
					img.loading = "lazy";
					img.referrerPolicy = "no-referrer";
					img.addEventListener("error", () => {
						img.hidden = true;
					});
					art.append(img);
				} else art.textContent = "♪";
				title.textContent = track.title;
				artist.textContent = track.artist;
				text.append(title, artist);
				button.append(art, text);
				li.append(button);
				list.append(li);
				button.addEventListener("click", () => {
					if (i === index) {
						if (intent) pause();
						else void play();
					} else selectTrack(i);
				});
				state?.rows.push({ button, track });
			});
		}
		for (const row of state.rows)
			row.button.setAttribute(
				"aria-pressed",
				String(row.track === tracks[index]),
			);
		if (lines && lyricsOpen && state.lyrics !== lyrics) {
			state.lyrics = lyrics;
			state.lyricRows = [];
			state.active = -2;
			lines.replaceChildren();
			lyrics.forEach((line) => {
				const li = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = line.text;
				button.addEventListener("click", () => {
					if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
					audio.currentTime = Math.min(line.time, audio.duration);
					widget.dataset.browseUntil = "0";
					renderProgress();
					save();
				});
				li.append(button);
				lines.append(li);
				state?.lyricRows.push(button);
			});
		}
		const noLyrics = widget.querySelector<HTMLElement>("[data-widget-current]");
		if (noLyrics) noLyrics.hidden = lyrics.length > 0;
		const active = activeLyricIndex(
			lyrics,
			audio.readyState >= 1 ? audio.currentTime : resumeTime,
		);
		state.lyricRows.forEach((button, i) => {
			if (i === active) button.setAttribute("aria-current", "true");
			else button.removeAttribute("aria-current");
		});
		const current = state.lyricRows[active];
		if (
			lines &&
			lyricsOpen &&
			current &&
			state.active !== active &&
			Date.now() >= Number(widget.dataset.browseUntil || 0)
		) {
			lines.scrollTop = Math.max(
				0,
				current.offsetTop - lines.clientHeight / 2 + current.offsetHeight / 2,
			);
			state.active = active;
		}
	}
	function renderSourceView() {
		onlineForm.hidden = sourceView !== "online";
		find("[data-music-curated]").setAttribute(
			"aria-pressed",
			String(sourceView === "curated"),
		);
		find("[data-music-online]").setAttribute(
			"aria-pressed",
			String(sourceView === "online"),
		);
		find("[data-music-online]").setAttribute(
			"aria-expanded",
			String(sourceView === "online"),
		);
		find("[data-music-active-source]").textContent =
			sourceKind === "curated"
				? "正在使用：默认歌单"
				: `正在使用：${sourceLink.textContent}`;
	}

	function filterQueue() {
		const query = trackSearch.value.trim().toLocaleLowerCase();
		let visible = 0;
		for (const { track, row } of trackRows) {
			row.hidden =
				!!query &&
				!`${track.title} ${track.artist}`.toLocaleLowerCase().includes(query);
			if (!row.hidden) visible++;
		}
		find("[data-music-search-clear]").hidden = !query;
		find("[data-music-queue-empty]").hidden = visible > 0;
		find("[data-music-filter-count]").textContent = query
			? `${visible} / ${tracks.length} 首`
			: "";
	}
	function renderAvailability() {
		for (const { track, row, button, badge } of trackRows) {
			const failed = failedTracks.has(track);
			const selected = tracks[index] === track;
			row.dataset.error = String(failed);
			button.setAttribute("aria-pressed", String(selected));
			button.setAttribute(
				"aria-label",
				`${selected && intent ? "暂停" : "播放"} ${track.title}`,
			);
			badge.textContent = failed
				? "暂时无法播放 · 可重试"
				: selected && intent
					? audio.paused
						? "正在加载"
						: "正在播放"
					: "";
			badge.hidden = !badge.textContent;
		}
	}
	trackSearch.addEventListener("input", filterQueue);
	find("[data-music-search-clear]").addEventListener("click", () => {
		trackSearch.value = "";
		filterQueue();
		trackSearch.focus({ preventScroll: true });
	});

	trackSearch.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !trackSearch.value) return;
		event.preventDefault();
		event.stopPropagation();
		trackSearch.value = "";
		filterQueue();
	});
	find("[data-music-locate]").addEventListener("click", () => {
		trackSearch.value = "";
		filterQueue();
		const current = trackRows[index];
		if (!current) return;
		playlist.scrollTop = Math.max(
			0,
			current.row.offsetTop -
				playlist.clientHeight / 2 +
				current.row.offsetHeight / 2,
		);
		current.button.focus({ preventScroll: true });
	});
	function suspendLyricFollow() {
		followLyrics = false;
		followButton.hidden = false;
	}
	lyricList.addEventListener("wheel", suspendLyricFollow, { passive: true });
	lyricList.addEventListener("touchstart", suspendLyricFollow, {
		passive: true,
	});
	lyricList.addEventListener("keydown", (event) => {
		if (
			["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
				event.key,
			)
		)
			suspendLyricFollow();
	});
	find<HTMLDetailsElement>("[data-music-lyrics-panel]").addEventListener(
		"toggle",
		(event) => {
			if ((event.currentTarget as HTMLDetailsElement).open && followLyrics) {
				lyricIndex = -2;
				renderLyric(audio.readyState >= 1 ? audio.currentTime : resumeTime);
			}
		},
	);
	followButton.addEventListener("click", () => {
		followLyrics = true;
		followButton.hidden = true;
		lyricIndex = -2;
		renderLyric(audio.currentTime);
	});
	find("[data-music-retry]").addEventListener("click", () => void play());
	find("[data-music-skip]").addEventListener("click", () =>
		selectTrack(nextIndex()),
	);
	function updateOfficialLink() {
		let href = officialMusicPage(tracks[index].url);
		if (!href && sourceKind === "online") {
			try {
				const url = new URL(sourceLink.href);
				if (
					["music.163.com", "y.qq.com"].includes(url.hostname) &&
					url.protocol === "https:"
				)
					href = url.href;
			} catch {
				/* Curated files need no external link. */
			}
		}
		officialLink.hidden = !href;
		find("[data-music-member-note]").hidden = !href?.includes("music.163.com");
		if (href) {
			officialLink.setAttribute("href", href);
			officialLink.textContent = href.includes("music.163.com")
				? "在网易云收听"
				: "在 QQ 音乐收听";
		} else officialLink.removeAttribute("href");
	}
	const petHandle = find<HTMLElement>("[data-pet-drag-handle]");
	petHandle.addEventListener("click", (event) => {
		if (!event.defaultPrevented) togglePlayback();
	});
	petHandle.addEventListener("keydown", (event) => {
		if (
			(event.key === "Enter" || event.key === " ") &&
			!event.repeat &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			togglePlayback();
		}
	});
	find('[data-pet-action="prev"]').addEventListener("click", () =>
		selectTrack(index - 1),
	);
	find('[data-pet-action="next"]').addEventListener("click", () =>
		selectTrack(nextIndex()),
	);
	find('[data-pet-action="lyrics"]').addEventListener("click", () => {
		petLyricsVisible = !petLyricsVisible;
		renderPet();
		save();
	});
	floatingToggle.addEventListener("click", () => {
		setLyricPlacement(!floatingLyrics);
	});
	lyricStrip.addEventListener("click", () => {
		setLyricPlacement(false);
		(embedded ? floatingToggle : opener).focus({ preventScroll: true });
	});
	officialLink.addEventListener("click", () => {
		if (!officialLink.getAttribute("href")) return;
		pause();
		message("已暂停博客音乐，请在音乐平台官方页面登录收听。");
	});
	function renderLyric(time: number) {
		const active = activeLyricIndex(lyrics, time);
		if (active === lyricIndex) return;
		lyricIndex = active;
		lyricButtons.forEach((button, i) => {
			if (i === active) button.setAttribute("aria-current", "true");
			else button.removeAttribute("aria-current");
		});
		if (!lyrics.length) return;
		lyricPreview.textContent =
			active >= 0 ? lyrics[active].text : "前奏 · 等待第一句";
		// Keep scrolling inside the lyric box; never move the article/page viewport.
		const current = lyricButtons[active];
		if (
			current &&
			followLyrics &&
			!find("[data-music-lyrics-panel]").hidden &&
			find<HTMLDetailsElement>("[data-music-lyrics-panel]").open
		) {
			lyricList.scrollTop = Math.max(
				0,
				current.offsetTop -
					lyricList.clientHeight / 2 +
					current.offsetHeight / 2,
			);
		}
	}
	function resetAssets() {
		followLyrics = true;
		followButton.hidden = true;
		audioSourceIndex = 0;
		lyricRequest?.abort();
		lyricTrack = undefined;
		assetTrack = undefined;
		lyrics = [];
		lyricButtons = [];
		lyricIndex = -2;
		lyricList.replaceChildren();
		lyricPreview.textContent = "播放后显示同步歌词";
		lyricStatus.textContent = "播放时加载同步歌词。";
		cover.hidden = true;
		cover.removeAttribute("src");
	}
	async function loadLyrics(track: Track) {
		if (lyricTrack === track) return;
		lyricRequest?.abort();
		const request = new AbortController();
		lyricRequest = request;
		lyricTrack = track;
		if (!track.lrc) {
			lyricStatus.textContent = "这首歌暂未提供歌词，安心听就好。";
			lyricPreview.textContent = "纯粹听歌 · 暂无歌词";
			return;
		}
		lyricStatus.textContent = "正在加载歌词…";
		const timer = setTimeout(() => request.abort(), 8000);
		try {
			let text = track.lrc;
			if (!isInlineLrc(text)) {
				const response = await fetch(text, {
					signal: request.signal,
					credentials: "omit",
					referrerPolicy: "no-referrer",
				});
				if (!response.ok) throw Error();
				text = await response.text();
			}
			if (
				request.signal.aborted ||
				tracks[index] !== track ||
				lyricTrack !== track ||
				lyricRequest !== request
			)
				return;
			lyrics = parseLrc(text);
			lyricButtons = lyrics.map((line, i) => {
				const item = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = line.text;
				button.dataset.lyricIndex = String(i);
				button.setAttribute(
					"aria-label",
					`${formatTime(line.time)} ${line.text}`,
				);
				item.append(button);
				lyricList.append(item);
				return button;
			});
			lyricStatus.textContent = lyrics.length
				? "点击一句歌词，跳到那一刻。"
				: "这首歌暂未提供同步歌词。";
			if (!lyrics.length) lyricPreview.textContent = "暂无同步歌词";
			renderLyric(audio.currentTime);
		} catch {
			if (
				tracks[index] !== track ||
				lyricTrack !== track ||
				lyricRequest !== request
			)
				return;
			lyricTrack = undefined;
			lyricStatus.textContent =
				"歌词暂时加载失败；暂停后再播放可重试，不影响听歌。";
			lyricPreview.textContent = "歌词暂不可用";
		} finally {
			clearTimeout(timer);
			renderFloating();
		}
	}
	function loadAssets() {
		const track = tracks[index];
		if (assetTrack !== track) {
			assetTrack = track;
			cover.hidden = true;
			if (track.cover) cover.src = track.cover;
		}
		void loadLyrics(track);
	}
	cover.addEventListener("load", () => {
		cover.hidden = false;
		renderWidget();
	});
	cover.addEventListener("error", () => {
		cover.hidden = true;
		renderWidget();
	});
	lyricList.addEventListener("click", (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
			"[data-lyric-index]",
		);
		const line = button ? lyrics[Number(button.dataset.lyricIndex)] : undefined;
		if (!line || !Number.isFinite(audio.duration)) return;
		followLyrics = true;
		followButton.hidden = true;
		lyricIndex = -2;
		audio.currentTime = Math.min(line.time, audio.duration);
		renderProgress();
		save();
	});
	function renderPlaylist() {
		trackRows = [];
		trackSearch.value = "";
		playlist.replaceChildren();
		tracks.forEach((track, i) => {
			const item = document.createElement("li");
			const button = document.createElement("button");
			const number = document.createElement("span");
			const text = document.createElement("span");
			const title = document.createElement("strong");
			const artist = document.createElement("small");
			const action = document.createElement("span");
			const badge = document.createElement("em");
			badge.className = "music-track-badge";
			badge.hidden = true;
			button.type = "button";
			button.dataset.musicTrack = String(i);
			button.setAttribute("aria-label", `播放 ${track.title}`);
			number.className = "music-track-number";
			number.textContent = String(i + 1).padStart(2, "0");
			title.textContent = track.title;
			artist.textContent = track.artist;
			text.append(title, artist, badge);
			action.textContent = "▷";
			action.setAttribute("aria-hidden", "true");
			button.append(number, text, action);
			item.append(button);
			playlist.append(item);
			trackRows.push({ track, row: item, button, badge });
		});
		find("[data-music-count]").textContent = `${tracks.length} 首`;
		filterQueue();
		renderAvailability();
	}
	function sourceMessage(text: string, error = false) {
		sourceStatus.textContent = text;
		sourceStatus.dataset.error = String(error);
	}
	function sourceBusy(busy: boolean) {
		onlineForm.setAttribute("aria-busy", String(busy));
		find<HTMLButtonElement>("[data-music-load]").disabled = busy;
		find("[data-music-load]").textContent = busy ? "正在加载…" : "加载歌单";
		find("[data-music-cancel]").hidden = !busy;
	}
	function switchPlaylist(
		nextTracks: Track[],
		kind: "curated" | "online",
		title: string,
		href: string,
	) {
		pause();
		tracks = nextTracks;
		sourceKind = kind;
		sourceView = kind;
		failedTracks.clear();
		index = 0;
		resumeTime = 0;
		audio.removeAttribute("src");
		audio.load();
		showDock = false;
		resetAssets();
		renderPlaylist();
		renderTrack();
		renderProgress();
		renderPlayback();
		save();
		sourceLink.textContent = title;
		sourceLink.href = href;
		updateOfficialLink();
		find("[data-music-source-note]").textContent =
			kind === "curated"
				? "默认歌单 · 在线播放"
				: "在线歌单 · 第三方接口 · 手动播放";
		renderSourceView();
		find<HTMLDetailsElement>("[data-music-queue-panel]").open = true;
		message("歌单已就绪，选一首开始听。");
	}
	find("[data-music-online]").addEventListener("click", () => {
		sourceView = "online";
		renderSourceView();
		playlistInput.focus({ preventScroll: true });
	});
	function cancelSource() {
		sourceRequest?.abort();
		sourceRequest = undefined;
		sourceBusy(false);
	}
	find("[data-music-curated]").addEventListener("click", () => {
		cancelSource();
		sourceView = "curated";
		renderSourceView();
		sourceMessage("");
		if (sourceKind !== "curated")
			switchPlaylist(
				curatedTracks,
				"curated",
				curatedSource.title,
				curatedSource.href,
			);
	});
	find("[data-music-cancel]").addEventListener("click", () => {
		cancelSource();
		sourceMessage("已取消加载，当前歌单保持不变。");
	});
	find("[data-music-example]").addEventListener("click", () => {
		playlistInput.value = "18638530828";
		platformInput.value = "netease";
		sourceMessage("已填入默认网易云歌单，点击「加载歌单」试听。");
		playlistInput.focus({ preventScroll: true });
	});
	onlineForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		cancelSource();
		const server: MusicServer =
			platformInput.value === "tencent" ? "tencent" : "netease";
		let id: string;
		try {
			id = parsePlaylistInput(playlistInput.value, server);
		} catch (error) {
			playlistInput.setAttribute("aria-invalid", "true");
			sourceMessage((error as Error).message, true);
			playlistInput.focus({ preventScroll: true });
			return;
		}
		playlistInput.removeAttribute("aria-invalid");
		const request = new AbortController();
		sourceRequest = request;
		sourceBusy(true);
		sourceMessage("正在读取公开歌单，当前音乐可以继续播放…");
		try {
			const nextTracks = await loadMetingPlaylist(
				{ server, id },
				request.signal,
			);
			if (request.signal.aborted || sourceRequest !== request) return;
			const name = server === "netease" ? "网易云音乐" : "QQ 音乐";
			const href =
				server === "netease"
					? `https://music.163.com/#/playlist?id=${id}`
					: `https://y.qq.com/n/ryqq/playlist/${id}`;
			switchPlaylist(nextTracks, "online", `${name} · ${id}`, href);
			sourceMessage(`已载入 ${nextTracks.length} 首曲目，点击曲目开始播放。`);
		} catch (error) {
			if (!request.signal.aborted && sourceRequest === request)
				sourceMessage((error as Error).message, true);
		} finally {
			if (sourceRequest === request) {
				sourceRequest = undefined;
				sourceBusy(false);
			}
		}
	});
	function renderTrack() {
		renderAvailability();
		updateOfficialLink();
		const track = tracks[index];
		find("[data-music-title]").textContent = track.title;
		find("[data-music-artist]").textContent = track.artist;
		document
			.querySelectorAll<HTMLButtonElement>("[data-music-track]")
			.forEach((button) => {
				button.setAttribute(
					"aria-pressed",
					String(Number(button.dataset.musicTrack) === index),
				);
			});
		if ("mediaSession" in navigator && "MediaMetadata" in window) {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: track.artist,
				album: "安秀 · 开发手记",
			});
		}
	}

	function finishAutoplay(state: "started" | "cancelled" | "failed") {
		if (!autoplayEnabled) return;
		autoplayPending = false;
		autoplayWaiting = false;
		panel.dataset.autoplay = state;
		window.removeEventListener("click", retryAutoplay, true);
		window.removeEventListener("keydown", retryAutoplay, true);
	}
	function retryAutoplay(event: Event) {
		if (!autoplayPending || !autoplayWaiting || !event.isTrusted) return;
		if (event.type === "keydown") {
			const key = event as KeyboardEvent;
			if (
				key.ctrlKey ||
				key.metaKey ||
				key.altKey ||
				[
					"Tab",
					"Escape",
					"Shift",
					"Control",
					"Alt",
					"Meta",
					"CapsLock",
				].includes(key.key)
			)
				return;
		}
		// These controls already own their click action. Do not start then immediately pause.
		const target = event.target as HTMLElement | null;
		if (target?.closest?.("#journal-player, [data-music-widget], #open-music"))
			return;
		autoplayWaiting = false;
		panel.dataset.autoplay = "attempting";
		void play(true);
	}
	async function play(automatic = false) {
		if (!automatic) finishAutoplay("cancelled");
		const currentVersion = ++version;
		loadAssets();
		intent = true;
		showDock = true;
		if (!audio.getAttribute("src") || audio.error) {
			if (audio.error && audio.readyState >= 1) resumeTime = audio.currentTime;
			audio.src = musicAudioSources(tracks[index].url)[audioSourceIndex];
			audio.load();
		}
		message("正在加载音乐…");
		renderPlayback();
		clearTimeout(slowTimer);
		slowTimer = setTimeout(() => {
			if (intent && audio.readyState < 3)
				message("加载较慢，可暂停后重试，或切换下一首。", true);
		}, 12000);
		try {
			await audio.play();
			if (currentVersion !== version) return;
		} catch (error) {
			if (currentVersion !== version) return;
			if (
				!(
					error instanceof DOMException &&
					["NotAllowedError", "AbortError"].includes(error.name)
				) &&
				tryAudioFallback(automatic)
			)
				return;
			intent = false;
			clearTimeout(slowTimer);
			const blocked =
				error instanceof DOMException && error.name === "NotAllowedError";
			if (blocked && automatic && autoplayPending) {
				autoplayWaiting = true;
				panel.dataset.autoplay = "waiting";
				message("点击页面或按键后开始播放音乐。");
			} else {
				if (automatic) finishAutoplay("failed");
				if (error instanceof DOMException && error.name === "AbortError")
					return;
				if (!blocked) failedTracks.add(tracks[index]);
				message(
					blocked
						? "浏览器暂停了播放，请再次点击播放。"
						: "音源暂时无法播放，点击播放重试，或切换下一首。",
					true,
				);
			}
			renderPlayback();
		}
	}
	function tryAudioFallback(automatic = false): boolean {
		const sources = musicAudioSources(tracks[index].url);
		if (!intent || audioSourceIndex + 1 >= sources.length) return false;
		if (audio.readyState >= 1) resumeTime = audio.currentTime;
		audioSourceIndex++;
		++version;
		audio.src = sources[audioSourceIndex];
		audio.load();
		void play(automatic);
		message("正在尝试备用音源…");
		return true;
	}
	function pause() {
		finishAutoplay("cancelled");
		++version;
		intent = false;
		clearTimeout(slowTimer);
		audio.pause();
		message("已暂停，点击播放继续。");
		renderPlayback();
		save();
	}
	function selectTrack(next: number) {
		pause();
		index = (next + tracks.length) % tracks.length;
		resumeTime = 0;
		resetAssets();
		audio.removeAttribute("src");
		audio.load();
		renderTrack();
		renderProgress();
		save();
		void play();
	}
	function togglePlayback() {
		if (intent) pause();
		else void play();
	}
	for (const button of toggles)
		button.addEventListener("click", togglePlayback);
	find("[data-music-prev]").addEventListener("click", () =>
		selectTrack(index - 1),
	);
	find("[data-music-next]").addEventListener("click", () =>
		selectTrack(nextIndex()),
	);
	playlist.addEventListener("click", (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
			"[data-music-track]",
		);
		const next = Number(button?.dataset.musicTrack);
		if (!button || !Number.isInteger(next) || !tracks[next]) return;
		if (next === index) {
			if (intent) pause();
			else void play();
		} else selectTrack(next);
	});
	for (const stopButton of [find("[data-music-stop]")])
		stopButton?.addEventListener("click", () => {
			pause();
			resumeTime = audio.readyState >= 1 ? audio.currentTime : resumeTime;
			audio.removeAttribute("src");
			audio.load();
			showDock = false;
			renderPlayback();
			(embedded ? toggles[0] : opener).focus({ preventScroll: true });
		});
	repeat.addEventListener("click", cyclePlayMode);
	function setVolume(value: string) {
		const number = Number(value);
		if (!Number.isFinite(number)) return;
		audio.volume = Math.max(0, Math.min(100, number)) / 100;
		audio.muted = false;
		renderVolume();
		save();
	}
	function toggleMute() {
		if (audio.muted || audio.volume === 0) {
			audio.muted = false;
			if (audio.volume === 0) audio.volume = 0.35;
		} else audio.muted = true;
		renderVolume();
		save();
	}
	volume.addEventListener("input", () => setVolume(volume.value));
	mute.addEventListener("click", toggleMute);
	quickVolume.addEventListener("input", () => setVolume(quickVolume.value));
	quickMute.addEventListener("click", toggleMute);
	function syncDrawerControls() {
		queueToggle.setAttribute(
			"aria-expanded",
			String(find<HTMLDetailsElement>("[data-music-queue-panel]").open),
		);
		lyricsToggle.setAttribute(
			"aria-expanded",
			String(find<HTMLDetailsElement>("[data-music-lyrics-panel]").open),
		);
	}
	for (const [button, selector] of [
		[queueToggle, "[data-music-queue-panel]"],
		[lyricsToggle, "[data-music-lyrics-panel]"],
	] as const) {
		const drawer = find<HTMLDetailsElement>(selector);
		button.addEventListener("click", () => {
			drawer.open = !drawer.open;
			syncDrawerControls();
		});
		drawer.addEventListener("toggle", syncDrawerControls);
	}
	function seekTo(value: string) {
		const position = Number(value);
		if (
			!Number.isFinite(position) ||
			!Number.isFinite(audio.duration) ||
			audio.duration <= 0
		)
			return;
		audio.currentTime =
			(Math.max(0, Math.min(1000, position)) / 1000) * audio.duration;
		renderProgress();
		save();
	}
	seek.addEventListener("input", () => seekTo(seek.value));
	panel.addEventListener("toggle", () => {
		opener.setAttribute(
			"aria-expanded",
			String(panel.matches(":popover-open")),
		);
		renderPlayback();
	});
	audio.addEventListener("loadedmetadata", () => {
		if (resumeTime > 0 && Number.isFinite(audio.duration)) {
			audio.currentTime = Math.min(
				resumeTime,
				Math.max(0, audio.duration - 0.1),
			);
			resumeTime = 0;
		}
		renderProgress();
	});
	audio.addEventListener("durationchange", renderProgress);
	audio.addEventListener("timeupdate", () => {
		renderProgress();
		if (Date.now() - lastSave > 5000) {
			save();
			lastSave = Date.now();
		}
	});
	audio.addEventListener("playing", () => {
		if (!intent) {
			audio.pause();
			return;
		}
		clearTimeout(slowTimer);
		if (autoplayPending) finishAutoplay("started");
		failedTracks.delete(tracks[index]);
		message("正在播放 · 浏览博客时可以继续听。");
		if ("mediaSession" in navigator)
			navigator.mediaSession.playbackState = "playing";
		renderPlayback();
	});
	audio.addEventListener("pause", () => {
		// Do not let a queued pause from an old source cancel a newer play request.
		if (audio.paused) {
			intent = false;
			clearTimeout(slowTimer);
		}
		if ("mediaSession" in navigator)
			navigator.mediaSession.playbackState = "paused";
		renderPlayback();
		save();
	});
	audio.addEventListener("waiting", () => {
		if (intent) message("正在缓冲音乐…");
	});
	audio.addEventListener("error", () => {
		if (!audio.error || !audio.getAttribute("src")) return;
		if (tryAudioFallback(autoplayPending)) return;
		if (autoplayPending) finishAutoplay("failed");
		failedTracks.add(tracks[index]);
		++version;
		intent = false;
		clearTimeout(slowTimer);
		message("音源暂时无法播放，点击播放重试，或切换下一首。", true);
		renderPlayback();
	});
	audio.addEventListener("ended", () =>
		selectTrack(repeatOne ? index : nextIndex()),
	);
	window.addEventListener("pagehide", () => {
		save();
		clearTimeout(slowTimer);
	});
	if ("mediaSession" in navigator) {
		const handlers = {
			play: () => void play(),
			pause,
			previoustrack: () => selectTrack(index - 1),
			nexttrack: () => selectTrack(nextIndex()),
		};
		for (const [action, handler] of Object.entries(handlers)) {
			try {
				navigator.mediaSession.setActionHandler(
					action as MediaSessionAction,
					handler,
				);
			} catch {
				/* Some browsers only support basic media actions. */
			}
		}
	}
	function syncMode() {
		const mode = document.body?.dataset.musicPage;
		if (mode !== undefined) embedded = mode === "true";
		if (panel.matches(":popover-open")) panel.hidePopover();
		if (panel.dataset.modeReady !== String(embedded)) {
			find<HTMLDetailsElement>("[data-music-queue-panel]").open = embedded;
			panel.dataset.modeReady = String(embedded);
		}
		panel.dataset.mode = embedded ? "page" : "popover";
		floatingToggle.hidden = !embedded;
		find<HTMLDetailsElement>("[data-music-lyrics-panel]").open = embedded;
		syncDrawerControls();
		if (embedded) {
			panel.removeAttribute("popover");
			opener.removeAttribute("popovertarget");
			opener.removeAttribute("aria-expanded");
		} else {
			panel.setAttribute("popover", "auto");
			opener.setAttribute("popovertarget", "music-panel");
			opener.setAttribute("aria-expanded", "false");
		}
		function heading(selector: string, tag: string, text: string) {
			const old = panel.querySelector<HTMLElement>(selector);
			if (!old) return;
			if (old.localName === tag) {
				old.textContent = text;
				return;
			}
			const next = document.createElement(tag);
			next.id = old.id;
			next.className = old.className;
			next.textContent = text;
			old.replaceWith(next);
		}
		heading(
			"#music-heading",
			embedded ? "h1" : "h2",
			embedded ? "音乐角落" : "听点音乐",
		);
		heading(
			".music-playlist-heading > :first-child",
			embedded ? "h2" : "h3",
			"播放列表",
		);
		const close = panel.querySelector<HTMLElement>("[data-music-close]");
		const stop = panel.querySelector<HTMLElement>(".music-page-stop");
		const link = panel.querySelector<HTMLElement>("[data-music-page-link]");
		if (close) close.hidden = embedded;
		if (stop) stop.hidden = !embedded;
		if (link) link.hidden = embedded;
		renderPlayback();
	}
	controllers.set(panel, syncMode);
	syncMode();
	renderSourceView();
	renderPlaylist();
	renderTrack();
	renderProgress();
	renderVolume();
	renderRepeat();
	renderPlayback();
	if (resumeTime > 0) message("已记住上次进度，点击播放继续听。");
	if (autoplayEnabled) {
		panel.dataset.autoplay = "attempting";
		window.addEventListener("click", retryAutoplay, { capture: true });
		window.addEventListener("keydown", retryAutoplay, { capture: true });
		void play(true);
	}
}
