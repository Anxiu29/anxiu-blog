import { getArticleProgress } from "./journal-reading";

type ReadingPosition = { v: 1; percent: number; updated: number };
const maxAge = 90 * 24 * 60 * 60 * 1000;

export function parseReadingPosition(
	raw: string | null,
	now = Date.now(),
): ReadingPosition | undefined {
	if (!raw || raw.length > 512) return;
	try {
		const value = JSON.parse(raw);
		if (
			value?.v !== 1 ||
			!Number.isInteger(value.percent) ||
			value.percent < 5 ||
			value.percent >= 95 ||
			!Number.isFinite(value.updated) ||
			value.updated <= 0 ||
			value.updated > now + 60_000 ||
			now - value.updated > maxAge
		)
			return;
		return { v: 1, percent: value.percent, updated: value.updated };
	} catch {
		return;
	}
}

export function getReadingResumeTop(
	rect: { top: number; height: number },
	viewport: number,
	inset: number,
	percent: number,
	scroll: number,
) {
	const available = viewport - inset;
	const relative =
		rect.height <= available
			? rect.top - viewport + (rect.height * percent) / 100
			: rect.top - inset + ((rect.height - available) * percent) / 100;
	return Math.max(0, scroll + relative);
}

const initialized = new WeakSet<HTMLElement>();
/** Only public articles render this control. No body text is saved or transmitted. */
export function initializeReadingResume() {
	const root = document.querySelector<HTMLElement>("[data-reading-resume]");
	const body = document.querySelector<HTMLElement>(".article-body");
	if (!root || !body || initialized.has(root)) return;
	const resume = root.querySelector<HTMLButtonElement>(
		"[data-resume-continue]",
	);
	const clear = root.querySelector<HTMLButtonElement>("[data-resume-clear]");
	const label = root.querySelector<HTMLElement>("[data-resume-percent]");
	if (!resume || !clear || !label) return;
	initialized.add(root);
	const key = `anxiu-reading-position-v1:${location.pathname}`;
	let saved: ReadingPosition | undefined;
	try {
		saved = parseReadingPosition(localStorage.getItem(key));
	} catch {
		/* Optional local preference. */
	}
	if (saved && !location.hash) {
		label.textContent = `${saved.percent}%`;
		root.hidden = false;
	}
	let dirty = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const inset = () =>
		Number.parseFloat(
			getComputedStyle(document.documentElement).scrollPaddingTop,
		) || 0;
	function flush() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		if (!dirty) return;
		dirty = false;
		const percent = getArticleProgress(
			body!.getBoundingClientRect(),
			window.innerHeight,
			inset(),
		);
		try {
			if (percent >= 95) {
				localStorage.removeItem(key);
				root!.hidden = true;
			} else if (percent >= 5)
				localStorage.setItem(
					key,
					JSON.stringify({ v: 1, percent, updated: Date.now() }),
				);
		} catch {
			/* Reading continues if storage is unavailable. */
		}
	}
	const onScroll = () => {
		dirty = true;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, 500);
	};
	const onVisibility = () => {
		if (document.hidden) flush();
	};
	document.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", onVisibility);
	document.addEventListener(
		"astro:before-swap",
		() => {
			flush();
			document.removeEventListener("scroll", onScroll);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", flush);
		},
		{ once: true },
	);
	resume.addEventListener("click", () => {
		if (!saved) return;
		root.hidden = true;
		const top = getReadingResumeTop(
			body.getBoundingClientRect(),
			window.innerHeight,
			inset(),
			saved.percent,
			window.scrollY,
		);
		body.tabIndex = -1;
		body.focus({ preventScroll: true });
		window.scrollTo({ top, behavior: "instant" });
	});
	clear.addEventListener("click", () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		dirty = false;
		saved = undefined;
		try {
			localStorage.removeItem(key);
		} catch {
			/* No retained data to clear. */
		}
		root.hidden = true;
		document
			.querySelector<HTMLSelectElement>("#reading-size")
			?.focus({ preventScroll: true });
	});
}
