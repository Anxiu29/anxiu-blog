const enhanced = new WeakSet();
let nextId = 0;

function uniqueId(document) {
	let id;
	do {
		id = `authoring-tabs-${++nextId}`;
	} while (document.getElementById(id));
	return id;
}

function currentCode(panel) {
	// Reuse Expressive Code's copy payload (it deliberately excludes gutters
	// and may omit terminal comments). Its newline separator is U+007F.
	const original = panel
		.querySelector("[data-code]")
		?.getAttribute("data-code");
	if (original !== undefined && original !== null)
		return original.replaceAll("\x7f", "\n");
	const code = panel.querySelector("pre code");
	if (!code) return "";
	const lines = [...code.querySelectorAll(".ec-line .code")];
	return lines.length
		? lines.map((line) => line.textContent ?? "").join("\n")
		: (code.textContent ?? "");
}

export function enhanceAuthoringGroup(
	group,
	writeClipboard = (value) => navigator.clipboard.writeText(value),
) {
	if (enhanced.has(group)) return;
	const panels = [...group.children].filter((child) =>
		child.matches("[data-tab-panel]"),
	);
	if (!panels.length) return;
	enhanced.add(group);
	const document = group.ownerDocument;
	const id = uniqueId(document);
	const toolbar = document.createElement("div");
	toolbar.className = "authoring-tab-toolbar";
	const tablist = document.createElement("div");
	tablist.className = "authoring-tablist";
	tablist.setAttribute("role", "tablist");
	tablist.setAttribute("aria-label", group.dataset.label || "内容选项");
	toolbar.append(tablist);
	const status = document.createElement("p");
	status.className = "authoring-copy-status";
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const manual = document.createElement("textarea");
	manual.className = "authoring-copy-fallback";
	manual.readOnly = true;
	manual.hidden = true;
	manual.setAttribute("aria-label", "自动复制失败，请手动复制当前代码");
	manual.setAttribute("spellcheck", "false");
	let active = 0;
	let request = 0;
	let copy;
	const buttons = panels.map((panel, index) => {
		const button = document.createElement("button");
		button.type = "button";
		button.id = `${id}-tab-${index}`;
		button.textContent = panel.dataset.label || `选项 ${index + 1}`;
		button.setAttribute("role", "tab");
		panel.id = `${id}-panel-${index}`;
		button.setAttribute("aria-controls", panel.id);
		panel.setAttribute("role", "tabpanel");
		panel.setAttribute("aria-labelledby", button.id);
		panel.tabIndex = 0;
		button.addEventListener("click", () => select(index, false));
		button.addEventListener("keydown", (event) => {
			let next;
			switch (event.key) {
				case "ArrowRight":
					next = (index + 1) % panels.length;
					break;
				case "ArrowLeft":
					next = (index + panels.length - 1) % panels.length;
					break;
				case "Home":
					next = 0;
					break;
				case "End":
					next = panels.length - 1;
					break;
				default:
					return;
			}
			event.preventDefault();
			select(next, true);
		});
		tablist.append(button);
		return button;
	});

	function select(index, focus) {
		active = index;
		request++;
		panels.forEach((panel, position) => {
			const selected = position === active;
			panel.hidden = !selected;
			buttons[position].setAttribute("aria-selected", String(selected));
			buttons[position].tabIndex = selected ? 0 : -1;
		});
		status.textContent = "";
		manual.hidden = true;
		manual.value = "";
		if (copy) copy.disabled = false;
		if (focus) buttons[index].focus();
	}

	if (group.dataset.authoringTabs === "code") {
		copy = document.createElement("button");
		copy.type = "button";
		copy.className = "authoring-copy";
		copy.textContent = "复制当前代码";
		copy.addEventListener("click", async () => {
			const token = ++request;
			const text = currentCode(panels[active]);
			const label = panels[active].dataset.label;
			copy.disabled = true;
			try {
				await writeClipboard(text);
				if (token === request) {
					status.textContent = `${label} 代码已复制`;
					manual.hidden = true;
				}
			} catch {
				if (token === request) {
					status.textContent = "自动复制失败，请在下方选择并手动复制代码。";
					manual.value = text;
					manual.hidden = false;
					manual.focus();
					manual.select();
				}
			} finally {
				if (token === request) copy.disabled = false;
			}
		});
		toolbar.append(copy);
		group.append(status, manual);
	}
	group.prepend(toolbar);
	group.dataset.enhanced = "true";
	select(0, false);
}

export function initAuthoringTabs(root = document) {
	root.querySelectorAll("[data-authoring-tabs]").forEach((group) => {
		enhanceAuthoringGroup(group);
	});
}
