/** Completion means the body bottom is visible below the sticky header. */
export function getArticleProgress(
	rect: { top: number; height: number },
	viewportHeight: number,
	topInset = 0,
) {
	if (rect.height <= 0 || viewportHeight <= topInset) return 0;
	const viewport = viewportHeight - topInset;
	const fraction =
		rect.height <= viewport
			? (viewportHeight - rect.top) / rect.height
			: (topInset - rect.top) / (rect.height - viewport);
	return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

type ShareServices = {
	share?: (data: { title: string; url: string }) => Promise<void>;
	clipboard?: { writeText: (value: string) => Promise<void> };
};

export async function shareArticleLink(
	url: string,
	title: string,
	preferNative: boolean,
	services: ShareServices = navigator,
): Promise<"shared" | "copied" | "manual" | "cancelled"> {
	if (preferNative && services.share) {
		try {
			await services.share({ title, url });
			return "shared";
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"name" in error &&
				error.name === "AbortError"
			)
				return "cancelled";
		}
	}
	try {
		if (services.clipboard?.writeText) {
			await services.clipboard.writeText(url);
			return "copied";
		}
	} catch {
		/* The visible, selectable input remains available without permission. */
	}
	return "manual";
}

const sharingInitialized = new WeakSet<HTMLElement>();
export function initializeArticleSharing() {
	for (const widget of document.querySelectorAll<HTMLElement>(
		"[data-share-widget]",
	)) {
		if (sharingInitialized.has(widget)) continue;
		const button = widget.querySelector<HTMLButtonElement>(
			"[data-article-share]",
		);
		const status = widget.querySelector<HTMLElement>("[data-share-status]");
		const fallback = widget.querySelector<HTMLElement>("[data-share-fallback]");
		const address = widget.querySelector<HTMLInputElement>(
			"[data-share-address]",
		);
		if (!button || !status || !fallback || !address) continue;
		sharingInitialized.add(widget);
		button.addEventListener("click", async () => {
			button.disabled = true;
			const result = await shareArticleLink(
				button.dataset.url || location.href,
				button.dataset.title || document.title,
				button.hasAttribute("data-native-share"),
			);
			button.disabled = false;
			status.textContent = {
				shared: "谢谢你的分享。",
				copied: "文章链接已复制。",
				manual: "请选中下方地址并手动复制。",
				cancelled: "已取消分享。",
			}[result];
			fallback.hidden = result !== "manual";
			if (result === "manual") {
				address.focus();
				address.select();
			}
		});
		widget
			.querySelector<HTMLButtonElement>("[data-share-dismiss]")
			?.addEventListener("click", () => {
				fallback.hidden = true;
				button.focus({ preventScroll: true });
			});
	}
}

const readingInitialized = new WeakSet<HTMLElement>();
export function initializeReadingTools() {
	const tools = document.querySelector<HTMLElement>(".reading-tools");
	const foundBody = document.querySelector<HTMLElement>(".article-body");
	if (!tools || !foundBody || readingInitialized.has(tools)) return;
	const body = foundBody;
	readingInitialized.add(tools);
	const size = document.querySelector<HTMLSelectElement>("#reading-size");
	const fill = document.querySelector<HTMLElement>("#reading-progress-fill");
	const percent = document.querySelector<HTMLElement>("#reading-percent");
	const toggle = document.querySelector<HTMLButtonElement>(
		"#toggle-reading-focus",
	);
	const exit = document.querySelector<HTMLButtonElement>("#exit-reading-focus");
	let pending = false;
	let disposed = false;
	function schedule() {
		if (pending || disposed) return;
		pending = true;
		requestAnimationFrame(() => {
			if (disposed) return;
			const inset =
				Number.parseFloat(
					getComputedStyle(document.documentElement).scrollPaddingTop,
				) || 0;
			const value = getArticleProgress(
				body.getBoundingClientRect(),
				window.innerHeight,
				inset,
			);
			if (fill) fill.style.width = `${value}%`;
			if (percent) percent.textContent = `${value}%`;
			pending = false;
		});
	}
	function applySize(value: string) {
		const safe = ["default", "large", "xlarge"].includes(value)
			? value
			: "default";
		body.dataset.readingSize = safe;
		if (size) size.value = safe;
	}
	try {
		applySize(localStorage.getItem("anxiu-reading-size") || "default");
	} catch {
		applySize("default");
	}
	size?.addEventListener("change", () => {
		applySize(size.value);
		try {
			localStorage.setItem("anxiu-reading-size", size.value);
		} catch {
			/* Optional preference. */
		}
		schedule();
	});
	function setFocus(active: boolean) {
		document.body.classList.toggle("reading-focus", active);
		toggle?.setAttribute("aria-pressed", String(active));
		if (toggle) toggle.textContent = active ? "退出专注" : "专注阅读";
		if (exit) exit.hidden = !active;
		if (!active) toggle?.focus({ preventScroll: true });
		schedule();
	}
	toggle?.addEventListener("click", () =>
		setFocus(!document.body.classList.contains("reading-focus")),
	);
	exit?.addEventListener("click", () => setFocus(false));
	const onKeydown = (event: KeyboardEvent) => {
		if (
			event.key === "Escape" &&
			!event.defaultPrevented &&
			document.body.classList.contains("reading-focus") &&
			!document.querySelector(
				"dialog[open], :popover-open, .explore-menu[open]",
			)
		) {
			event.preventDefault();
			setFocus(false);
		}
	};
	document.addEventListener("keydown", onKeydown);
	document.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : undefined;
	resize?.observe(body);
	document.addEventListener("astro:before-swap", () => {
		disposed = true;
		document.removeEventListener("keydown", onKeydown);
		document.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		resize?.disconnect();
	}, { once: true });
	schedule();
}

const tocInitialized = new WeakSet<HTMLElement>();
export function initializeArticleToc() {
	const column = document.querySelector<HTMLElement>(".article-column");
	const lists = [...document.querySelectorAll<HTMLElement>("[data-toc-items]")];
	if (!column || !lists.length || tocInitialized.has(column)) return;
	tocInitialized.add(column);
	let signature = "";
	let scheduled = false;
	let disposed = false;
	function update() {
		if (disposed) return;
		const headings = [
			...document.querySelectorAll<HTMLElement>(
				".article-body h2[id], .article-body h3[id]",
			),
		].filter((heading) => !heading.closest("[hidden]"));
		const nextSignature = JSON.stringify(
			headings.map((h) => [h.id, h.tagName, h.textContent]),
		);
		if (signature !== nextSignature) {
			signature = nextSignature;
			for (const list of lists) {
				const links = headings.map((heading) => {
					const link = document.createElement("a");
					link.href = `#${encodeURIComponent(heading.id)}`;
					link.textContent =
						heading.textContent?.replace(/#$/, "").trim() || heading.id;
					link.setAttribute("data-toc-link", "");
					link.className = heading.tagName === "H3" ? "nested" : "";
					return link;
				});
				list.replaceChildren(...links);
			}
		}
		for (const region of document.querySelectorAll<HTMLElement>(
			"[data-toc-region]",
		)) {
			if (region.hidden !== !headings.length) region.hidden = !headings.length;
		}
		const offset =
			(Number.parseFloat(
				getComputedStyle(document.documentElement).scrollPaddingTop,
			) || 110) + 20;
		let current = headings[0]?.id;
		for (const heading of headings) {
			if (heading.getBoundingClientRect().top <= offset) current = heading.id;
			else break;
		}
		for (const link of document.querySelectorAll<HTMLAnchorElement>(
			"[data-toc-link]",
		)) {
			if (decodeURIComponent(link.hash.slice(1)) === current)
				link.setAttribute("aria-current", "location");
			else link.removeAttribute("aria-current");
		}
		scheduled = false;
	}
	function schedule() {
		if (scheduled || disposed) return;
		scheduled = true;
		requestAnimationFrame(update);
	}
	document.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	document.addEventListener("password:decrypted", schedule);
	const observer = new MutationObserver(schedule);
	observer.observe(column, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["hidden"],
	});
	document.addEventListener("astro:before-swap", () => {
		disposed = true;
		observer.disconnect();
		document.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		document.removeEventListener("password:decrypted", schedule);
	}, { once: true });
	schedule();
}
