export const SAVED_ARTICLES_KEY = "anxiu-saved-articles-v1";
type SavedArticle = { path: string; savedAt: number };
type ArticleStorage = Pick<Storage, "getItem" | "setItem">;

function validPath(path: unknown): path is string {
	if (typeof path !== "string" || !/^\/posts\/[^?#\s\\]+\/$/.test(path))
		return false;
	try {
		return new URL(path, "https://blog.test").pathname === path;
	} catch {
		return false;
	}
}

export function readSavedArticles(
	storage: Pick<Storage, "getItem">,
): SavedArticle[] {
	const raw = storage.getItem(SAVED_ARTICLES_KEY);
	if (!raw) return [];
	const value: unknown = JSON.parse(raw);
	if (
		!value ||
		typeof value !== "object" ||
		!("version" in value) ||
		value.version !== 1 ||
		!("items" in value) ||
		!Array.isArray(value.items) ||
		value.items.length > 1000
	)
		throw new Error("Invalid collection");
	const unique = new Map<string, SavedArticle>();
	for (const item of value.items) {
		if (
			!item ||
			!validPath(item.path) ||
			!Number.isFinite(item.savedAt) ||
			item.savedAt < 0
		)
			throw new Error("Invalid saved article");
		if ((unique.get(item.path)?.savedAt ?? -1) < item.savedAt)
			unique.set(item.path, { path: item.path, savedAt: item.savedAt });
	}
	return [...unique.values()]
		.sort((a, b) => b.savedAt - a.savedAt || a.path.localeCompare(b.path))
		.slice(0, 200);
}

export function setArticleSaved(
	storage: ArticleStorage,
	path: string,
	saved: boolean,
	now = Date.now(),
) {
	if (!validPath(path) || !Number.isFinite(now) || now < 0)
		throw new Error("Invalid article");
	const records = readSavedArticles(storage);
	if (records.some((item) => item.path === path) === saved) return;
	const next = records.filter((item) => item.path !== path);
	if (saved) next.unshift({ path, savedAt: now });
	storage.setItem(
		SAVED_ARTICLES_KEY,
		JSON.stringify({ version: 1, items: next.slice(0, 200) }),
	);
}

const buttons = new WeakSet<HTMLElement>();
const documents = new WeakSet<Document>();

function publicPaths(): Set<string> {
	try {
		return new Set(
			JSON.parse(
				document.querySelector<HTMLElement>("#saved-article-catalog")?.dataset
					.paths || "[]",
			),
		);
	} catch {
		return new Set();
	}
}

function refreshSavedArticles() {
	const allowed = publicPaths();
	let records: SavedArticle[] = [];
	let failed = false;
	try {
		records = readSavedArticles(localStorage);
	} catch {
		failed = true;
	}
	const known = records.filter((item) => allowed.has(item.path));
	const saved = new Set(known.map((item) => item.path));
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-save-article]",
	)) {
		button.disabled = failed || !allowed.has(button.dataset.saveArticle || "");
		button.setAttribute(
			"aria-pressed",
			String(saved.has(button.dataset.saveArticle || "")),
		);
		const label = button.querySelector("[data-save-label]");
		if (label)
			label.textContent = saved.has(button.dataset.saveArticle || "")
				? "取消收藏"
				: "收藏文章";
	}
	for (const card of document.querySelectorAll<HTMLElement>(
		"[data-saved-card]",
	))
		card.hidden = !saved.has(card.dataset.savedCard || "");
	const list = document.querySelector<HTMLElement>("[data-saved-list]");
	if (list)
		for (const item of known) {
			const card = [
				...list.querySelectorAll<HTMLElement>("[data-saved-card]"),
			].find((card) => card.dataset.savedCard === item.path);
			if (card) list.append(card);
		}
	const empty = document.querySelector<HTMLElement>("[data-saved-empty]");
	if (empty) empty.hidden = failed || known.length > 0;
	const message = failed
		? "无法读取本机收藏。请检查浏览器存储设置，原有数据没有被重置。"
		: `已收藏 ${known.length} 篇文章${records.length > known.length ? "；不再公开的文章已隐藏" : ""}。`;
	const status = document.querySelector("[data-saved-status]");
	if (status) status.textContent = message;
	if (failed)
		for (const status of document.querySelectorAll("[data-save-status]"))
			status.textContent = message;
}

export function initializeSavedArticles() {
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-save-article]",
	)) {
		if (buttons.has(button)) continue;
		buttons.add(button);
		button.addEventListener("click", () => {
			const path = button.dataset.saveArticle || "";
			if (!publicPaths().has(path)) return;
			const desired = button.getAttribute("aria-pressed") !== "true";
			try {
				setArticleSaved(localStorage, path, desired);
				refreshSavedArticles();
				if (
					!desired &&
					button.closest<HTMLElement>("[data-saved-card]")?.hidden
				) {
					const next = document.querySelector<HTMLElement>(
						"[data-saved-card]:not([hidden]) h2 a, [data-saved-status]",
					);
					next?.focus({ preventScroll: true });
				}
				for (const status of document.querySelectorAll("[data-save-status]"))
					status.textContent = desired
						? "已收藏，仅保存在此浏览器。"
						: "已取消收藏。";
			} catch {
				for (const status of document.querySelectorAll(
					"[data-save-status], [data-saved-status]",
				))
					status.textContent =
						"未能保存收藏，请检查浏览器存储空间或权限。原有记录保持不变。";
			}
		});
	}
	refreshSavedArticles();
	if (documents.has(document)) return;
	documents.add(document);
	window.addEventListener("storage", (event) => {
		if (event.key === SAVED_ARTICLES_KEY || event.key === null)
			refreshSavedArticles();
	});
}
