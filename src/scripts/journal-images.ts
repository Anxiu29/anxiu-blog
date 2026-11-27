const initialized = new WeakSet<HTMLDialogElement>();

export function initializeArticleImages() {
	const dialog = document.querySelector<HTMLDialogElement>(
		"#article-image-viewer",
	);
	const preview = document.querySelector<HTMLImageElement>(
		"#article-viewer-image",
	);
	const caption = document.querySelector<HTMLElement>(
		"#article-viewer-caption",
	);
	const count = document.querySelector<HTMLElement>("#article-viewer-count");
	const previous = document.querySelector<HTMLButtonElement>(
		"#article-viewer-prev",
	);
	const next = document.querySelector<HTMLButtonElement>(
		"#article-viewer-next",
	);
	const close = document.querySelector<HTMLButtonElement>(
		"#article-viewer-close",
	);
	const navigation = document.querySelector<HTMLElement>(
		"#article-viewer-navigation",
	);
	const error = document.querySelector<HTMLElement>("#article-viewer-error");
	const figure = document.querySelector<HTMLElement>("#article-viewer-figure");
	if (
		!dialog ||
		!preview ||
		!previous ||
		!next ||
		!close ||
		initialized.has(dialog)
	)
		return;
	initialized.add(dialog);
	const viewer = { dialog, preview, previous, next, close };

	const buttons = new WeakMap<HTMLImageElement, HTMLButtonElement>();
	let current: HTMLImageElement | null = null;
	let opener: HTMLButtonElement | null = null;

	function images() {
		return [
			...document.querySelectorAll<HTMLImageElement>(
				".article-body img, .article-project-cover img",
			),
		].filter((image) => {
			if (!(image.currentSrc || image.getAttribute("src"))) return false;
			if (
				image.closest(
					"a, .mermaid-diagram-container, .plantuml-diagram-container, [data-no-image-viewer]",
				)
			)
				return false;
			const button = image.closest("button");
			return !button || button === buttons.get(image);
		});
	}
	function label(image: HTMLImageElement) {
		return (
			image
				.closest("figure")
				?.querySelector("figcaption")
				?.textContent?.trim() ||
			image.alt.trim() ||
			"文章图片"
		);
	}
	function render(image: HTMLImageElement) {
		const all = images();
		const index = all.indexOf(image);
		if (index < 0) return;
		current = image;
		viewer.preview.hidden = false;
		if (error) error.hidden = true;
		viewer.preview.src = image.currentSrc || image.src;
		viewer.preview.alt = label(image);
		if (caption) caption.textContent = label(image);
		if (count) count.textContent = `${index + 1} / ${all.length}`;
		viewer.previous.disabled = index === 0;
		viewer.next.disabled = index === all.length - 1;
		if (navigation) navigation.hidden = all.length < 2;
	}
	function move(offset: number) {
		if (!current) return;
		const all = images();
		const index = all.indexOf(current);
		if (index < 0) {
			viewer.dialog.close();
			return;
		}
		const image = all[index + offset];
		if (image) render(image);
	}
	function prepare() {
		const all = images();
		for (const image of all) {
			if (buttons.has(image)) continue;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "article-image-button";
			button.setAttribute("aria-label", `查看大图：${label(image)}`);
			button.setAttribute("aria-haspopup", "dialog");
			const content = image.closest("picture") || image;
			content.before(button);
			button.append(content);
			buttons.set(image, button);
			button.addEventListener("click", () => {
				opener = button;
				render(image);
				if (!viewer.dialog.open) viewer.dialog.showModal();
				viewer.close.focus();
			});
		}
		if (viewer.dialog.open && current && !all.includes(current))
			viewer.dialog.close();
	}
	previous.addEventListener("click", () => move(-1));
	next.addEventListener("click", () => move(1));
	close.addEventListener("click", () => dialog.close());
	dialog.addEventListener("keydown", (event) => {
		if (
			!dialog.open ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		)
			return;
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault();
			move(event.key === "ArrowLeft" ? -1 : 1);
		}
	});
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog || event.target === figure) dialog.close();
	});
	dialog.addEventListener("close", () => {
		preview.removeAttribute("src");
		current = null;
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	});
	preview.addEventListener("error", () => {
		preview.hidden = true;
		if (error) error.hidden = false;
	});
	preview.addEventListener("load", () => {
		preview.hidden = false;
		if (error) error.hidden = true;
	});
	prepare();
	const column = document.querySelector(".article-column");
	const observer = column ? new MutationObserver(prepare) : undefined;
	if (column)
		observer?.observe(column, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["src", "srcset"],
		});
	document.addEventListener("password:decrypted", prepare);
	document.addEventListener(
		"astro:before-swap",
		() => {
			observer?.disconnect();
			document.removeEventListener("password:decrypted", prepare);
		},
		{ once: true },
	);
}
