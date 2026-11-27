/** Own the decorative video's lifetime and respect system media preferences. */
export function createBackgroundVideo(
	video: HTMLVideoElement,
	src: string,
	onPaused: (paused: boolean) => void,
	say: (message: string) => void,
) {
	let currentSrc = src;
	let active = false;
	let manualPaused = false;
	let failed = false;
	let pending = false;
	let attempt = 0;
	let explicitPlayback = false;
	let pageHidden = false;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const connection = (
		navigator as Navigator & {
			connection?: EventTarget & { saveData?: boolean };
		}
	).connection;
	const preferStill = () => reducedMotion.matches || !!connection?.saveData;
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	const release = () => {
		++attempt;
		pending = false;
		video.pause();
		if (video.hasAttribute("src")) {
			video.removeAttribute("src");
			video.load();
		}
	};
	const shouldPause = () =>
		!active ||
		manualPaused ||
		document.hidden ||
		pageHidden ||
		failed ||
		(preferStill() && !explicitPlayback);
	function update() {
		if (!active) return;
		if (preferStill() && !explicitPlayback) {
			release();
			onPaused(true);
			say(
				"已遵循减少动态效果或节省流量设置，使用静态封面；点击播放可播放当前壁纸。",
			);
			return;
		}
		if (shouldPause()) {
			++attempt;
			pending = false;
			video.pause();
			onPaused(true);
			return;
		}
		if (!video.hasAttribute("src")) video.src = currentSrc;
		if (!video.paused || pending) return;
		const token = ++attempt;
		pending = true;
		void video
			.play()
			.then(() => {
				if (token !== attempt) {
					if (shouldPause()) video.pause();
					return;
				}
				pending = false;
				if (shouldPause()) video.pause();
				else onPaused(false);
			})
			.catch((error) => {
				if (token !== attempt || !active) return;
				pending = false;
				failed = true;
				video.pause();
				onPaused(true);
				say(
					error?.name === "NotAllowedError"
						? "浏览器暂停了自动播放，先显示静态封面；点击播放即可继续。"
						: "动态壁纸暂时无法播放，已显示静态封面，可点击播放重试。",
				);
			});
	}
	video.addEventListener("error", () => {
		if (!active || !video.hasAttribute("src")) return;
		failed = true;
		release();
		onPaused(true);
		say("动态壁纸暂时无法加载，已显示静态封面，可点击播放重试。");
	});
	video.addEventListener("playing", () => {
		if (shouldPause()) {
			video.pause();
			onPaused(true);
			return;
		}
		onPaused(false);
		say("动态壁纸正在静音循环播放。");
	});
	video.addEventListener("pause", () => {
		if (active) onPaused(true);
	});
	const preferenceChanged = () => {
		explicitPlayback = false;
		update();
	};
	reducedMotion.addEventListener("change", preferenceChanged);
	connection?.addEventListener("change", preferenceChanged);
	document.addEventListener("visibilitychange", update);
	window.addEventListener("pagehide", () => {
		pageHidden = true;
		++attempt;
		pending = false;
		video.pause();
	});
	window.addEventListener("pageshow", () => {
		pageHidden = false;
		update();
	});
	return {
		sync(
			nextActive: boolean,
			paused: boolean,
			explicit = false,
			nextSrc = src,
		) {
			if (nextSrc !== currentSrc) {
				release();
				currentSrc = nextSrc;
				failed = false;
				explicitPlayback = false;
			}
			const entering = nextActive && !active;
			active = nextActive;
			manualPaused = paused;
			video.hidden = !active;
			if (!active) {
				failed = false;
				explicitPlayback = false;
				release();
				return;
			}
			if (explicit) {
				failed = false;
				explicitPlayback = !paused;
			}
			if (entering) failed = false;
			update();
		},
	};
}
