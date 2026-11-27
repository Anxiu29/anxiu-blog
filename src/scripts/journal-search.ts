type SearchRecord = {
	title: string;
	description: string;
	url: string;
	type: string;
	text: string;
};

const initializedSearchRoots = new WeakSet<HTMLElement>();

function plainText(text: string): string {
	return text
		.replace(/^\s*:{2,}[a-z][\w-]*(?:\[([^\]]*)\])?.*$/gim, "$1")
		.replace(/^\s*:{2,}\s*$/gm, " ")
		.replace(/^\s*[-*+]\s+\[[x ]\]\s*/gim, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<\/?[a-zA-Z][^>]*>/g, " ")
		.replace(/^\s*```.*$/gm, " ")
		.replace(/\*\*([^\n]+?)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^ {0,3}(?:#{1,6}\s+|>\s?)/gm, "")
		.replace(/\s+/g, " ")
		.trim();
}

function termPattern(terms: string[]): RegExp {
	return new RegExp(
		[...terms]
			.sort((a, b) => b.length - a.length)
			.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|"),
		"giu",
	);
}

function highlight(element: HTMLElement, text: string, terms: string[]) {
	if (!terms.length) {
		element.textContent = text;
		return;
	}
	let end = 0;
	for (const match of text.matchAll(termPattern(terms))) {
		const start = match.index;
		element.append(document.createTextNode(text.slice(end, start)));
		const mark = document.createElement("mark");
		mark.textContent = match[0];
		element.append(mark);
		end = start + match[0].length;
	}
	element.append(document.createTextNode(text.slice(end)));
}

function excerpt(text: string, terms: string[]): string {
	const hit = text.search(termPattern(terms));
	if (hit < 0) return "";
	// Slice by code points so an emoji at either edge stays intact.
	const chars = Array.from(text);
	const offset = Array.from(text.slice(0, hit)).length;
	const start = Math.max(0, offset - 35);
	const end = Math.min(chars.length, start + 150);
	return `${start ? "…" : ""}${chars.slice(start, end).join("").trim()}${end < chars.length ? "…" : ""}`;
}

function parseRecords(data: unknown): SearchRecord[] {
	if (!Array.isArray(data)) throw new Error("Invalid search data");
	return data.filter((record): record is SearchRecord => {
		if (!record || typeof record !== "object") return false;
		if (
			!["title", "description", "url", "type", "text"].every(
				(key) => typeof record[key] === "string",
			)
		)
			return false;
		return (
			(record.url.startsWith("/") && !record.url.startsWith("//")) ||
			/^https?:\/\//i.test(record.url)
		);
	});
}

export function createSearchLoader(fetcher: typeof fetch, timeout = 10000) {
	const cache = new Map<string, Promise<SearchRecord[]>>();
	return (url: string): Promise<SearchRecord[]> => {
		const previous = cache.get(url);
		if (previous) return previous;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		const pending = fetcher(url, {
			signal: controller.signal,
			credentials: "same-origin",
		})
			.then((response) => {
				if (!response.ok) throw new Error("Search index unavailable");
				return response.json();
			})
			.then(parseRecords)
			.catch((error) => {
				cache.delete(url);
				throw error;
			})
			.finally(() => clearTimeout(timer));
		cache.set(url, pending);
		return pending;
	};
}
let remoteLoader: ReturnType<typeof createSearchLoader> | undefined;
function loadRemote(url: string) {
	remoteLoader ||= createSearchLoader(
		(input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
	);
	return remoteLoader(url);
}

// Load the same-origin index only when search is used; all roots share its request.
export function initializeJournalSearch() {
	const config = document.querySelector<HTMLElement>("#search-data");
	const source = config?.dataset.source || "";
	let records: SearchRecord[] = [];
	let unavailable = false;
	try {
		if (config?.dataset.records)
			records = parseRecords(JSON.parse(config.dataset.records));
	} catch {
		unavailable = true;
	}
	const buildIndex = (records: SearchRecord[]) =>
		records.map((record, order) => {
			const body = plainText(record.text);
			return {
				record,
				order,
				body,
				title: record.title.toLocaleLowerCase(),
				description: record.description.toLocaleLowerCase(),
				text: `${record.title} ${record.description} ${record.text} ${body}`.toLocaleLowerCase(),
			};
		});
	let index = buildIndex(records);
	for (const root of document.querySelectorAll<HTMLElement>(
		"[data-site-search]",
	)) {
		if (initializedSearchRoots.has(root)) continue;
		const input = root.querySelector<HTMLInputElement>('input[type="search"]');
		const results = root.querySelector<HTMLElement>("[data-search-results]");
		const status = root.querySelector<HTMLElement>("[data-search-status]");
		if (!input || !results || !status) continue;
		initializedSearchRoots.add(root);
		const fullPage = root.hasAttribute("data-search-page");
		let composing = false;
		let links: HTMLAnchorElement[] = [];
		const scope = root.querySelector<HTMLSelectElement>("[data-search-kind]");
		const retry = root.querySelector<HTMLButtonElement>("[data-search-retry]");
		let loaded = !source;
		let loading = false;
		let disposed = false;
		function ensureLoaded() {
			if (loaded || loading || !source) return;
			loading = true;
			unavailable = false;
			update();
			void loadRemote(source)
				.then((data) => {
					records = data;
					index = buildIndex(data);
					loaded = true;
				})
				.catch(() => {
					unavailable = true;
				})
				.finally(() => {
					loading = false;
					if (!disposed) update();
				});
		}
		retry?.addEventListener("click", ensureLoaded);
		scope?.addEventListener("change", commit);
		input.addEventListener("focus", ensureLoaded);
		if (fullPage)
			document.addEventListener(
				"astro:before-swap",
				() => {
					disposed = true;
				},
				{ once: true },
			);
		function syncUrl() {
			if (!fullPage || !input) return;
			const url = new URL(location.href);
			const query = input.value.trim();
			if (query) url.searchParams.set("q", query);
			else url.searchParams.delete("q");
			if (scope?.value) url.searchParams.set("kind", scope.value);
			else url.searchParams.delete("kind");
			history.replaceState(
				history.state,
				"",
				url.pathname + url.search + url.hash,
			);
		}
		function update() {
			if (!input || !results || !status) return;
			const query = input.value.trim();
			const terms = [
				...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean)),
			];
			const scopedIndex = scope?.value
				? index.filter((item) => item.record.type === scope.value)
				: index;
			const matches = terms.length
				? scopedIndex
						.filter((item) => terms.every((term) => item.text.includes(term)))
						.map((item) => ({
							...item,
							score: terms.reduce(
								(sum, term) =>
									sum +
									(item.title.includes(term)
										? 3
										: item.description.includes(term)
											? 1
											: 0),
								0,
							),
						}))
						.sort((a, b) => b.score - a.score || a.order - b.order)
				: scopedIndex.slice(0, 4);
			const shown = fullPage ? matches : matches.slice(0, 12);
			root.setAttribute("aria-busy", String(loading));
			if (retry) retry.hidden = !unavailable || loading;
			status.textContent = loading
				? "正在加载搜索索引…"
				: unavailable
					? "搜索暂时不可用，可以重试，或从文章归档继续浏览。"
					: terms.length
						? matches.length
							? `找到 ${matches.length} 个结果${shown.length < matches.length ? `，显示前 ${shown.length} 个` : ""}。`
							: "没有找到匹配内容，可以试试“WebHID”“待办”或“雾镇”。"
						: records.length
							? "可以从这些记录开始，或输入关键词搜索。"
							: "尚无可搜索内容，可以从文章归档或工具箱继续浏览。";
			results.replaceChildren();
			links = [];
			for (const item of shown) {
				const li = document.createElement("li");
				const link = document.createElement("a");
				link.href = item.record.url;
				const title = document.createElement("strong");
				highlight(title, item.record.title, terms);
				const description = document.createElement("span");
				highlight(
					description,
					`${item.record.type} · ${item.record.description}`,
					terms,
				);
				link.append(title, description);
				const context = terms.length ? excerpt(item.body, terms) : "";
				if (context) {
					const snippet = document.createElement("p");
					snippet.className = "search-excerpt";
					highlight(snippet, context, terms);
					link.append(snippet);
				}
				const position = links.length;
				link.addEventListener("keydown", (event) => {
					if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
						return;
					if (event.key === "ArrowUp") {
						event.preventDefault();
						(position ? links[position - 1] : input).focus();
					} else if (
						event.key === "ArrowDown" ||
						event.key === "Home" ||
						event.key === "End"
					) {
						event.preventDefault();
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? links.length - 1
									: Math.min(position + 1, links.length - 1);
						links[next]?.focus();
					}
				});
				links.push(link);
				li.append(link);
				results.append(li);
			}
			const expanded =
				document.querySelector<HTMLAnchorElement>("[data-full-search]");
			if (!fullPage && expanded)
				expanded.href =
					"/search/" +
					(query || scope?.value
						? "?" +
							new URLSearchParams({
								...(query ? { q: query } : {}),
								...(scope?.value ? { kind: scope.value } : {}),
							}).toString()
						: "");
		}
		function commit() {
			ensureLoaded();
			update();
			syncUrl();
		}
		input.addEventListener("compositionstart", () => {
			composing = true;
		});
		input.addEventListener("compositionend", () => {
			composing = false;
			commit();
		});
		input.addEventListener("input", (event) => {
			if (!composing && !(event as InputEvent).isComposing) commit();
		});
		input.addEventListener("keydown", (event) => {
			if (composing || event.isComposing || event.keyCode === 229) return;
			// Native search inputs otherwise consume the first Escape to clear text.
			if (event.key === "Escape" && !fullPage) {
				const dialog = root.closest<HTMLDialogElement>("dialog");
				if (dialog?.open) {
					event.preventDefault();
					dialog.close();
				}
				return;
			}
			if (
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				!links.length
			)
				return;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				links[event.key === "ArrowDown" ? 0 : links.length - 1]?.focus();
			} else if (event.key === "Enter") {
				event.preventDefault();
				links[0]?.click();
			}
		});
		root
			.querySelector("form")
			?.addEventListener("submit", (event) => event.preventDefault());
		if (fullPage) {
			input.value = new URLSearchParams(location.search).get("q") || "";
			if (scope)
				scope.value = new URLSearchParams(location.search).get("kind") || "";
			const onPopstate = () => {
				composing = false;
				input.value = new URLSearchParams(location.search).get("q") || "";
				if (scope)
					scope.value = new URLSearchParams(location.search).get("kind") || "";
				update();
			};
			window.addEventListener("popstate", onPopstate);
			document.addEventListener(
				"astro:before-swap",
				() => window.removeEventListener("popstate", onPopstate),
				{ once: true },
			);
		}
		update();
		if (fullPage) ensureLoaded();
	}
}
