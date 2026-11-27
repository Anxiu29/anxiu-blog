export function getPageScrollProgress(
	top: number,
	height: number,
	viewport: number,
) {
	if (![top, height, viewport].every(Number.isFinite) || height <= viewport)
		return 0;
	return Math.round(Math.max(0, Math.min(1, top / (height - viewport))) * 100);
}

const initialized = new WeakSet<Document>();
function sync() {
	const button = document.querySelector<HTMLElement>("#back-top");
	if (!button) return;
	const percent = getPageScrollProgress(
		window.scrollY,
		document.documentElement.scrollHeight,
		window.innerHeight,
	);
	button.hidden = window.scrollY < 500;
	button.style.setProperty("--page-progress", String(percent));
	button.title = `返回顶部 · 页面进度 ${percent}%`;
	const label = button.querySelector("[data-scroll-percent]");
	if (label) label.textContent = `${percent}%`;
}
export function initializeScrollTools() {
	sync();
	if (initialized.has(document)) return;
	initialized.add(document);
	let pending = false;
	const update = () => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			sync();
		});
	};
	document.addEventListener("scroll", update, { passive: true });
	window.addEventListener("resize", update);
	// Layout can settle after images or a restored scroll position.
	document.addEventListener("astro:page-load", update);
	document.addEventListener("password:decrypted", update);
}
