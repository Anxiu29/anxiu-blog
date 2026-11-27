const initializedNotices = new WeakSet<HTMLElement>();
const dismissalKey = "anxiu-notice-dismissed";

export function initializeDiscoveryNotices(
	root: Document = document,
	browser: Window = window,
) {
	for (const notice of root.querySelectorAll<HTMLElement>(
		"[data-discovery-notice]",
	)) {
		if (initializedNotices.has(notice)) continue;
		initializedNotices.add(notice);
		const version = notice.dataset.discoveryNotice;
		try {
			notice.hidden =
				!!version && browser.localStorage.getItem(dismissalKey) === version;
		} catch {}
		notice
			.querySelector<HTMLButtonElement>("[data-dismiss-discovery-notice]")
			?.addEventListener("click", () => {
				// Keep keyboard users at the following sidebar action when their button disappears.
				notice.nextElementSibling
					?.querySelector<HTMLElement>('a,button,summary,[tabindex="0"]')
					?.focus();
				notice.hidden = true;
				try {
					if (version) browser.localStorage.setItem(dismissalKey, version);
				} catch {}
			});
	}
}
