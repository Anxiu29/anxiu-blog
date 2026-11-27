const initializedArchiveForms = new WeakSet<HTMLFormElement>();

export function initializeArchiveFilter() {
	const form = document.querySelector<HTMLFormElement>(".archive-filter");
	const input = document.querySelector<HTMLInputElement>("#archive-query");
	const category =
		document.querySelector<HTMLSelectElement>("#archive-category");
	const status = document.querySelector("#archive-status");
	const empty = document.querySelector<HTMLElement>("#archive-empty");
	const clearTag =
		document.querySelector<HTMLButtonElement>("#archive-clear-tag");
	if (!form || !input || !category || initializedArchiveForms.has(form)) return;
	initializedArchiveForms.add(form);
	const rows = [...document.querySelectorAll<HTMLElement>("[data-post-row]")];
	let tag = "";
	let composing = false;
	const removeMissingCategory = () =>
		category.querySelector("[data-archive-missing]")?.remove();
	const readURL = () => {
		const params = new URLSearchParams(location.search);
		input.value = params.get("q") || "";
		tag = params.get("tag") || "";
		const requested = params.get("category") || "";
		removeMissingCategory();
		if (
			requested &&
			!Array.from(category.options).some((option) => option.value === requested)
		) {
			const option = document.createElement("option");
			option.value = requested;
			option.textContent = `已失效的分类：${requested}`;
			option.setAttribute("data-archive-missing", "");
			category.append(option);
		}
		category.value = requested;
	};
	const filter = (mode: "push" | "replace" | false = "replace") => {
		const query = input.value.trim();
		const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
		const selected = category.value;
		let count = 0;
		for (const row of rows) {
			const matches =
				terms.every((term) =>
					row.dataset.filterText?.toLocaleLowerCase().includes(term),
				) &&
				(!selected || row.dataset.category === selected) &&
				(!tag || (row.dataset.tags || "").split("|").includes(tag));
			row.hidden = !matches;
			if (matches) count++;
		}
		const label = [selected && `分类「${selected}」`, tag && `标签「${tag}」`]
			.filter(Boolean)
			.join(" · ");
		if (status)
			status.textContent = `${label ? `${label} · ` : ""}共 ${count} 篇文章`;
		if (empty) empty.hidden = count > 0;
		if (clearTag) {
			clearTag.hidden = !tag;
			clearTag.textContent = `移除标签：${tag}`;
		}
		if (!mode) return;
		const url = new URL(location.href);
		if (
			(url.searchParams.get("q") || "") === query &&
			(url.searchParams.get("category") || "") === selected &&
			(url.searchParams.get("tag") || "") === tag
		)
			return;
		for (const key of ["q", "category", "tag"]) url.searchParams.delete(key);
		if (query) url.searchParams.set("q", query);
		if (selected) url.searchParams.set("category", selected);
		if (tag) url.searchParams.set("tag", tag);
		if (url.href !== location.href) {
			history[mode === "push" ? "pushState" : "replaceState"](
				history.state,
				"",
				url.pathname + url.search + url.hash,
			);
		}
	};
	input.addEventListener("compositionstart", () => {
		composing = true;
	});
	input.addEventListener("compositionend", () => {
		composing = false;
		filter();
	});
	input.addEventListener("input", (event) => {
		if (!composing && !(event as InputEvent).isComposing) filter();
	});
	category.addEventListener("change", () => {
		removeMissingCategory();
		filter("push");
	});
	clearTag?.addEventListener("click", () => {
		tag = "";
		filter("push");
		input.focus({ preventScroll: true });
	});
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!composing) filter("push");
	});
	form.addEventListener("reset", (event) => {
		event.preventDefault();
		composing = false;
		input.value = "";
		removeMissingCategory();
		category.value = "";
		tag = "";
		filter("push");
	});
	const onPopstate = () => {
		composing = false;
		readURL();
		filter(false);
	};
	window.addEventListener("popstate", onPopstate);
	document.addEventListener(
		"astro:before-swap",
		() => window.removeEventListener("popstate", onPopstate),
		{ once: true },
	);
	readURL();
	filter(false);
}
