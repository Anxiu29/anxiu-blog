const initialized = new WeakSet<Document>();
const wallpaperButtons = new WeakSet<HTMLElement>();
const enhanced = new WeakSet<HTMLElement>();
function syncChrome() {
	const dark = document.documentElement.classList.contains("dark");
	const meta = document.querySelector<HTMLMetaElement>(
		'meta[name="theme-color"]',
	);
	if (meta) meta.content = dark ? "#131b26" : "#edf1f6";
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
function enhanceContent() {
	const body = document.querySelector<HTMLElement>(".article-body");
	if (body && !enhanced.has(body)) {
		enhanced.add(body);
		const resize = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const box = entry.target as HTMLElement;
				box.tabIndex = box.scrollWidth > box.clientWidth + 1 ? 0 : -1;
			}
		});
		const wrap = () => {
			for (const table of body.querySelectorAll("table")) {
				if (table.parentElement?.classList.contains("content-scroll")) continue;
				const container = document.createElement("div");
				container.className = "content-scroll";
				container.setAttribute("role", "region");
				container.setAttribute("aria-label", "表格，内容较宽时可横向滚动");
				table.before(container);
				container.append(table);
				resize.observe(container);
			}
			for (const formula of body.querySelectorAll<HTMLElement>(
				".katex-display",
			)) {
				if (formula.classList.contains("content-scroll")) continue;
				formula.classList.add("content-scroll");
				formula.setAttribute("role", "region");
				formula.setAttribute("aria-label", "公式，内容较宽时可横向滚动");
				resize.observe(formula);
			}
		};
		wrap();
		const observer = new MutationObserver(wrap);
		observer.observe(body, {
			childList: true,
			subtree: true,
		});
		document.addEventListener(
			"astro:before-swap",
			() => {
				resize.disconnect();
				observer.disconnect();
			},
			{ once: true },
		);
	}
}

export function initializeShell() {
	const shortcut = document.querySelector("[data-search-shortcut]");
	if (shortcut)
		shortcut.textContent = navigator.userAgent.includes("Macintosh")
			? "⌘ K"
			: "Ctrl K";
	for (const button of document.querySelectorAll<HTMLElement>(
		"[data-open-wallpaper]",
	)) {
		if (wallpaperButtons.has(button)) continue;
		wallpaperButtons.add(button);
		button.addEventListener("click", () =>
			document.querySelector<HTMLButtonElement>("#open-appearance")?.click(),
		);
	}
	syncChrome();
	enhanceContent();
	if (initialized.has(document)) return;
	initialized.add(document);
	new MutationObserver(syncChrome).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	const search = document.querySelector<HTMLDialogElement>("#search-dialog");
	search?.querySelectorAll("a").forEach((a) => {
		a.addEventListener("click", () => search.close());
	});
	document.addEventListener("password:decrypted", enhanceContent);
}
