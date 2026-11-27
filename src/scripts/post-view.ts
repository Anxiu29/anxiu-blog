export const POST_VIEW_KEY = "anxiu-post-view-v1";
export type PostView = "cards" | "compact";
const initialized = new WeakSet<HTMLElement>();

export function readPostView(storage: Pick<Storage, "getItem">): PostView {
	try {
		return storage.getItem(POST_VIEW_KEY) === "compact" ? "compact" : "cards";
	} catch {
		return "cards";
	}
}

export function initializePostView() {
	const panel = document.querySelector<HTMLElement>("#post-view-settings");
	if (!panel || initialized.has(panel)) return;
	initialized.add(panel);
	const radios = [
		...panel.querySelectorAll<HTMLInputElement>("[name=post-view]"),
	];
	const status = panel.querySelector<HTMLElement>("[data-post-view-status]");
	function apply(view: PostView) {
		document.documentElement.dataset.postView = view;
		for (const radio of radios) radio.checked = radio.value === view;
	}
	function restore() {
		try {
			apply(readPostView(localStorage));
		} catch {
			apply("cards");
		}
	}
	for (const radio of radios)
		radio.addEventListener("change", () => {
			if (!radio.checked) return;
			const view = radio.value === "compact" ? "compact" : "cards";
			apply(view);
			try {
				localStorage.setItem(POST_VIEW_KEY, view);
				if (status) status.textContent = "文章显示方式已保存在此浏览器。";
			} catch {
				if (status)
					status.textContent = "已应用到当前页面，浏览器无法保存此偏好。";
			}
		});
	panel
		.querySelector("[data-reset-post-view]")
		?.addEventListener("click", () => {
			apply("cards");
			try {
				localStorage.removeItem(POST_VIEW_KEY);
				if (status) status.textContent = "已恢复封面卡片。";
			} catch {
				if (status)
					status.textContent = "当前页面已恢复，浏览器无法清除原偏好。";
			}
		});
	window.addEventListener("storage", (event) => {
		if (event.key === POST_VIEW_KEY || event.key === null) restore();
	});
	restore();
}
