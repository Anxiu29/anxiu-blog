export function initializeArchiveFilter() {
	const form = document.querySelector<HTMLFormElement>(".archive-filter");
	const input = document.querySelector<HTMLInputElement>("#archive-query");
	const category =
		document.querySelector<HTMLSelectElement>("#archive-category");
	const status = document.querySelector("#archive-status");
	const empty = document.querySelector<HTMLElement>("#archive-empty");
	const clearTag =
		document.querySelector<HTMLButtonElement>("#archive-clear-tag");
	if (!form || !input || !category) return;
	const rows = [...document.querySelectorAll<HTMLElement>("[data-post-row]")];
	let tag = "";
	let missingCategory = "";
	function readURL() {
		const params = new URLSearchParams(location.search);
		input!.value = params.get("q") || "";
		tag = params.get("tag") || "";
		const requested = params.get("category") || "";
		category!.value = requested;
		missingCategory =
			requested && category!.value !== requested ? requested : "";
	}
	function filter(sync = true) {
		const query = input!.value.trim();
		const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
		const selected = missingCategory || category!.value;
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
		if (sync) {
			const url = new URL(location.href);
			for (const key of ["q", "category", "tag"]) url.searchParams.delete(key);
			if (query) url.searchParams.set("q", query);
			if (selected) url.searchParams.set("category", selected);
			if (tag) url.searchParams.set("tag", tag);
			history.replaceState(null, "", url);
		}
	}
	input.addEventListener("input", () => filter());
	category.addEventListener("change", () => {
		missingCategory = "";
		filter();
	});
	clearTag?.addEventListener("click", () => {
		tag = "";
		filter();
	});
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		filter();
	});
	form.addEventListener("reset", (event) => {
		event.preventDefault();
		input.value = "";
		category.value = "";
		tag = "";
		missingCategory = "";
		filter();
	});
	window.addEventListener("popstate", () => {
		readURL();
		filter(false);
	});
	readURL();
	filter(false);
}
