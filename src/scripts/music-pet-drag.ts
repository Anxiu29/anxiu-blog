type PetPosition = { x: number; y: number };
const initialized = new WeakSet<HTMLElement>();
const positionKey = "anxiu-music-pet-position-v1";

export function initializeMusicPetDrag() {
	const foundPet = document.querySelector<HTMLElement>("[data-music-pet]");
	const foundHandle = foundPet?.querySelector<HTMLElement>(
		"[data-pet-drag-handle]",
	);
	if (!foundPet || !foundHandle || initialized.has(foundPet)) return;
	const pet = foundPet;
	const handle = foundHandle;
	initialized.add(pet);
	const menu = pet.querySelector<HTMLButtonElement>("[data-pet-menu]");
	function setControls(open: boolean) {
		pet.dataset.controlsOpen = String(open);
		menu?.setAttribute("aria-expanded", String(open));
		menu?.setAttribute("aria-label", open ? "收起宠物音乐控制" : "展开宠物音乐控制");
	}
	menu?.addEventListener("click", () => setControls(pet.dataset.controlsOpen !== "true"));
	pet.addEventListener("keydown", (event: KeyboardEvent) => {
		if (event.key === "Escape") { setControls(false); menu?.focus(); }
	});
	pet.querySelector('[data-pet-action="lyrics"]')?.addEventListener("click", () => setControls(false));
	let position: PetPosition | undefined;
	let gesture:
		| {
				id: number;
				pointerX: number;
				pointerY: number;
				origin: PetPosition;
				moved: boolean;
		  }
		| undefined;
	let suppressClick = false;
	pet.dataset.dragging = "false";

	function save() {
		if (!position) return;
		try {
			localStorage.setItem(positionKey, JSON.stringify(position));
		} catch {
			/* Moving works without storage. */
		}
	}
	function place(next: PetPosition) {
		const rect = pet.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
		const minX = Math.min(12, Math.max(0, viewportWidth - rect.width));
		const minY = Math.min(12, Math.max(0, window.innerHeight - rect.height));
		const maxX = Math.max(minX, viewportWidth - rect.width - 12);
		const maxY = Math.max(minY, window.innerHeight - rect.height - 12);
		position = {
			x: Math.max(minX, Math.min(maxX, next.x)),
			y: Math.max(minY, Math.min(maxY, next.y)),
		};
		pet.style.setProperty("left", `${position.x}px`);
		pet.style.setProperty("top", `${position.y}px`);
		pet.style.setProperty("right", "auto");
		pet.style.setProperty("bottom", "auto");
	}
	try {
		const stored = JSON.parse(localStorage.getItem(positionKey) || "null");
		if (
			stored &&
			typeof stored.x === "number" &&
			typeof stored.y === "number" &&
			Number.isFinite(stored.x) &&
			Number.isFinite(stored.y)
		) {
			position = { x: stored.x, y: stored.y };
			place(position);
		}
	} catch {
		/* Invalid preferences must not affect music. */
	}

	handle.addEventListener("pointerdown", (event: PointerEvent) => {
		if (event.button !== 0 || event.isPrimary === false || gesture) return;
		const rect = pet.getBoundingClientRect();
		gesture = {
			id: event.pointerId,
			pointerX: event.clientX,
			pointerY: event.clientY,
			origin: { x: rect.left, y: rect.top },
			moved: false,
		};
		suppressClick = false;
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			/* Pointer capture may be unavailable. */
		}
	});
	handle.addEventListener("pointermove", (event: PointerEvent) => {
		if (!gesture || event.pointerId !== gesture.id) return;
		const dx = event.clientX - gesture.pointerX;
		const dy = event.clientY - gesture.pointerY;
		if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
		gesture.moved = true;
		setControls(false);
		pet.dataset.dragging = "true";
		event.preventDefault();
		place({ x: gesture.origin.x + dx, y: gesture.origin.y + dy });
	});
	function finish(pointerId: number, cancelled: boolean) {
		if (!gesture || gesture.id !== pointerId) return;
		const completed = gesture;
		gesture = undefined;
		pet.dataset.dragging = "false";
		if (completed.moved) {
			if (cancelled) place(completed.origin);
			else {
				suppressClick = true;
				save();
			}
		}
		try {
			if (handle.hasPointerCapture(pointerId))
				handle.releasePointerCapture(pointerId);
		} catch {
			/* A cancelled pointer may have lost capture already. */
		}
	}
	handle.addEventListener("pointerup", (event: PointerEvent) =>
		finish(event.pointerId, false),
	);
	handle.addEventListener("pointercancel", (event: PointerEvent) =>
		finish(event.pointerId, true),
	);
	handle.addEventListener("lostpointercapture", (event: PointerEvent) =>
		finish(event.pointerId, true),
	);
	handle.addEventListener(
		"click",
		(event) => {
			if (!suppressClick) return;
			suppressClick = false;
			event.preventDefault();
			event.stopPropagation();
		},
		{ capture: true },
	);
	handle.addEventListener("keydown", (event: KeyboardEvent) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === "Home") {
			event.preventDefault();
			if (gesture) finish(gesture.id, true);
			position = undefined;
			for (const property of ["left", "top", "right", "bottom"])
				pet.style.removeProperty(property);
			try {
				localStorage.removeItem(positionKey);
			} catch {
				/* Optional storage. */
			}
			return;
		}
		const direction: Record<string, PetPosition> = {
			ArrowLeft: { x: -1, y: 0 },
			ArrowRight: { x: 1, y: 0 },
			ArrowUp: { x: 0, y: -1 },
			ArrowDown: { x: 0, y: 1 },
		};
		const delta = direction[event.key];
		if (!delta) return;
		event.preventDefault();
		const step = event.shiftKey ? 1 : 10;
		const rect = pet.getBoundingClientRect();
		place({ x: rect.left + delta.x * step, y: rect.top + delta.y * step });
		save();
	});
	window.addEventListener("resize", () => {
		if (gesture) finish(gesture.id, false);
		if (!position) return;
		place(position);
		save();
	});
}
