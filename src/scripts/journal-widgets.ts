type CalendarEntry = { date: string; title: string; url: string };

const initialized = new WeakSet<HTMLElement>();
export function initializeJournalWidgets() {
	const clock = document.querySelector<HTMLTimeElement>("#sidebar-clock");
	const owner =
		clock || document.querySelector<HTMLElement>("#calendar-post-data");
	if (!owner || initialized.has(owner)) return;
	initialized.add(owner);
	const date = document.querySelector("#sidebar-date");
	const greeting = document.querySelector("#sidebar-greeting");
	function tick() {
		const now = new Date();
		if (clock) {
			clock.dateTime = now.toISOString();
			clock.textContent = now.toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			});
		}
		if (date)
			date.textContent = now.toLocaleDateString("zh-CN", {
				month: "long",
				day: "numeric",
				weekday: "long",
			});
		if (greeting)
			greeting.textContent =
				now.getHours() < 6
					? "夜深了，早点休息。"
					: now.getHours() < 12
						? "上午好，欢迎来访。"
						: now.getHours() < 18
							? "下午好，留一点时间给自己。"
							: "晚上好，欢迎回来。";
	}
	let timer: ReturnType<typeof setInterval> | undefined;
	const start = () => {
		tick();
		if (clock && !timer) timer = setInterval(tick, 30_000);
	};
	const stop = () => {
		clearInterval(timer);
		timer = undefined;
	};
	start();
	window.addEventListener("pagehide", stop);
	window.addEventListener("pageshow", start);
	const onVisibility = () => {
		if (document.hidden) stop();
		else start();
	};
	document.addEventListener("visibilitychange", onVisibility);
	document.addEventListener(
		"astro:before-swap",
		() => {
			stop();
			window.removeEventListener("pagehide", stop);
			window.removeEventListener("pageshow", start);
			document.removeEventListener("visibilitychange", onVisibility);
		},
		{ once: true },
	);
	const data = document.querySelector<HTMLElement>("#calendar-post-data");
	const days = document.querySelector<HTMLElement>("[data-calendar-days]");
	const label = document.querySelector("[data-calendar-label]");
	const selection = document.querySelector<HTMLElement>(
		"[data-calendar-selection]",
	);
	const selectionTitle = document.querySelector(
		"[data-calendar-selection-title]",
	);
	const selectionLinks = document.querySelector(
		"[data-calendar-selection-links]",
	);
	if (
		!data ||
		!days ||
		!label ||
		!selection ||
		!selectionTitle ||
		!selectionLinks
	)
		return;
	let entries: CalendarEntry[] = [];
	try {
		entries = JSON.parse(data.dataset.dates || "[]");
	} catch {
		return;
	}
	const now = new Date();
	let year = now.getFullYear();
	let month = now.getMonth();
	function render() {
		if (!days || !label || !selection || !selectionTitle || !selectionLinks)
			return;
		label.textContent = `${year} 年 ${month + 1} 月`;
		selection.hidden = true;
		days.replaceChildren();
		const offset = (new Date(year, month, 1).getDay() + 6) % 7;
		for (let i = 0; i < offset; i++) {
			const blank = document.createElement("span");
			blank.setAttribute("aria-hidden", "true");
			days.append(blank);
		}
		for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
			const stamp = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			const posts = entries.filter((e) => e.date === stamp);
			const cell = document.createElement(posts.length ? "button" : "span");
			cell.textContent = String(day);
			if (cell instanceof HTMLButtonElement) {
				cell.type = "button";
				cell.className = "has-post";
				cell.setAttribute("aria-label", `${stamp}，${posts.length} 篇文章`);
				cell.setAttribute("aria-pressed", "false");
				cell.addEventListener("click", () => {
					days.querySelectorAll("button").forEach((b) => {
						b.setAttribute("aria-pressed", String(b === cell));
					});
					selectionTitle.textContent = `${month + 1} 月 ${day} 日 · ${posts.length} 篇文章`;
					selectionLinks.replaceChildren();
					for (const post of posts) {
						const li = document.createElement("li");
						const a = document.createElement("a");
						a.href = post.url;
						a.textContent = post.title;
						li.append(a);
						selectionLinks.append(li);
					}
					selection.hidden = false;
				});
			}
			if (
				year === now.getFullYear() &&
				month === now.getMonth() &&
				day === now.getDate()
			) {
				cell.classList.add("is-today");
				cell.setAttribute("aria-current", "date");
			}
			days.append(cell);
		}
	}
	document.querySelector("[data-month-prev]")?.addEventListener("click", () => {
		month--;
		if (month < 0) {
			month = 11;
			year--;
		}
		render();
	});
	document.querySelector("[data-month-next]")?.addEventListener("click", () => {
		month++;
		if (month > 11) {
			month = 0;
			year++;
		}
		render();
	});
	document
		.querySelector("[data-month-today]")
		?.addEventListener("click", () => {
			const today = new Date();
			year = today.getFullYear();
			month = today.getMonth();
			render();
		});
	render();
}
