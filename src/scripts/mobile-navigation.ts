const initialized = new WeakSet<HTMLDialogElement>();

export function initializeMobileNavigation() {
	const dialog =
		document.querySelector<HTMLDialogElement>("#mobile-navigation");
	const opener = document.querySelector<HTMLButtonElement>("#open-navigation");
	if (!dialog || !opener || initialized.has(dialog)) return;
	initialized.add(dialog);
	const setClosed = () => {
		opener.setAttribute("aria-expanded", "false");
		document.documentElement.classList.remove("navigation-open");
	};
	const close = () => dialog.close();
	opener.addEventListener("click", () => {
		if (dialog.open) {
			close();
			return;
		}
		document.querySelector<HTMLDialogElement>("#search-dialog")?.close();
		document.querySelector<HTMLDialogElement>("#appearance-dialog")?.close();
		const music = document.querySelector<HTMLElement>("#music-panel");
		if (music?.matches(":popover-open")) music.hidePopover();
		dialog.showModal();
		opener.setAttribute("aria-expanded", "true");
		document.documentElement.classList.add("navigation-open");
	});
	dialog
		.querySelector("[data-close-navigation]")
		?.addEventListener("click", close);
	dialog.addEventListener("close", setClosed);
	dialog.addEventListener("click", (event) => {
		if (event.target !== dialog) return;
		const box = dialog.getBoundingClientRect();
		if (
			event.clientX < box.left ||
			event.clientX > box.right ||
			event.clientY < box.top ||
			event.clientY > box.bottom
		)
			close();
	});
	dialog.querySelectorAll("a").forEach((link) => {
		link.addEventListener("click", close);
	});
	window
		.matchMedia("(min-width: 1051px)")
		.addEventListener("change", (event) => {
			if (event.matches && dialog.open) close();
		});
	window.addEventListener("pagehide", () => {
		if (dialog.open) close();
	});
}
