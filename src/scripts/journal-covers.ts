const initializedCovers = new WeakSet<HTMLElement>();

/** Preserve the cover box and article link when a decorative screenshot fails. */
export function initializePostCovers() {
	for (const cover of document.querySelectorAll<HTMLElement>(
		"[data-post-cover]",
	)) {
		if (initializedCovers.has(cover)) continue;
		const image = cover.querySelector<HTMLImageElement>("img");
		const fallback = cover.querySelector<HTMLElement>("[data-cover-fallback]");
		if (!image || !fallback) continue;
		initializedCovers.add(cover);
		const render = (failed: boolean) => {
			cover.dataset.coverState = failed ? "error" : "ready";
			image.hidden = failed;
			fallback.hidden = !failed;
		};
		image.addEventListener("load", () => render(false));
		image.addEventListener("error", () => render(true));
		if (image.complete) render(image.naturalWidth === 0);
	}
}
