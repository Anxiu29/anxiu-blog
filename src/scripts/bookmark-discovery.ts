const initializedForms = new WeakSet<HTMLFormElement>();

/** Bookmark filters are shareable in the URL; only this page's q/tag keys change. */
export function initializeBookmarkDiscovery(
	root: Document = document,
	browser: Window = window,
) {
	const form = root.querySelector<HTMLFormElement>("#bookmark-form");
	const foundQuery = root.querySelector<HTMLInputElement>("#bookmark-query");
	if (!form || !foundQuery || initializedForms.has(form)) return;
	const query = foundQuery;
	initializedForms.add(form);
	const tags = [
		...root.querySelectorAll<HTMLButtonElement>("[data-bookmark-tag]"),
	];
	const cards = [...root.querySelectorAll<HTMLElement>("[data-bookmark-card]")];
	const groups = [
		...root.querySelectorAll<HTMLElement>("[data-bookmark-group-section]"),
	];
	const status = root.querySelector<HTMLElement>("#bookmark-status");
	const empty = root.querySelector<HTMLElement>("#bookmark-empty");
	const pick = root.querySelector<HTMLButtonElement>("#pick-bookmark");
	const picked = root.querySelector<HTMLElement>("#bookmark-pick");
	let selectedTag = "";

	function filter(writeUrl = true) {
		const terms = query.value
			.trim()
			.toLocaleLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		let count = 0;
		for (const card of cards) {
			const text = card.dataset.filterText?.toLocaleLowerCase() || "";
			card.hidden =
				!terms.every((term) => text.includes(term)) ||
				(!!selectedTag &&
					!(card.dataset.tags || "").split("|").includes(selectedTag));
			if (!card.hidden) count++;
		}
		for (const group of groups)
			group.hidden = [
				...group.querySelectorAll<HTMLElement>("[data-bookmark-card]"),
			].every((card) => card.hidden);
		for (const button of tags)
			button.setAttribute(
				"aria-pressed",
				String(button.dataset.bookmarkTag === selectedTag),
			);
		if (status)
			status.textContent = `${selectedTag ? `「${selectedTag}」 · ` : ""}${count} / ${cards.length} 个站点`;
		if (empty) empty.hidden = count > 0;
		if (pick) pick.disabled = count === 0;
		if (picked) {
			picked.hidden = true;
			picked.replaceChildren();
		}
		if (writeUrl) {
			const url = new URL(browser.location.href);
			url.searchParams.delete("q");
			url.searchParams.delete("tag");
			if (query.value.trim()) url.searchParams.set("q", query.value.trim());
			if (selectedTag) url.searchParams.set("tag", selectedTag);
			// Filtering remains useful in browsers which disallow history writes.
			try {
				browser.history.replaceState(browser.history.state, "", url);
			} catch {}
		}
	}
	function readUrl() {
		const params = new URL(browser.location.href).searchParams;
		query.value = params.get("q") || "";
		const requestedTag = params.get("tag") || "";
		selectedTag = tags.some(
			(button) => button.dataset.bookmarkTag === requestedTag,
		)
			? requestedTag
			: "";
		filter(requestedTag !== selectedTag);
	}
	query.addEventListener("input", () => filter());
	for (const button of tags)
		button.addEventListener("click", () => {
			selectedTag = button.dataset.bookmarkTag || "";
			filter();
		});
	form.addEventListener("submit", (event) => event.preventDefault());
	form.addEventListener("reset", (event) => {
		event.preventDefault();
		query.value = "";
		selectedTag = "";
		filter();
	});
	browser.addEventListener("popstate", readUrl);
	root.addEventListener?.("astro:before-swap", () => browser.removeEventListener("popstate", readUrl), { once: true });
	pick?.addEventListener("click", () => {
		const visible = cards.filter((card) => !card.hidden);
		const chosen = visible[
			Math.floor(Math.random() * visible.length)
		]?.querySelector<HTMLAnchorElement>("[data-bookmark-link]");
		if (!chosen || !picked) return;
		const link = root.createElement("a");
		link.href = chosen.href;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = `去逛逛：${chosen.textContent?.trim()} ↗`;
		picked.replaceChildren(link);
		picked.hidden = false;
	});
	const copy = root.querySelector<HTMLButtonElement>("[data-copy-site-info]");
	const info = root.querySelector<HTMLTextAreaElement>("#site-info-text");
	const copyStatus = root.querySelector<HTMLElement>("#site-copy-status");
	copy?.addEventListener("click", async () => {
		if (!info) return;
		let copied = false;
		try {
			await browser.navigator.clipboard.writeText(info.value);
			copied = true;
		} catch {
			info.focus();
			info.select();
		}
		if (copyStatus)
			copyStatus.textContent = copied
				? "已复制本站信息。"
				: "已选中本站信息，请手动复制。";
	});
	readUrl();
}
