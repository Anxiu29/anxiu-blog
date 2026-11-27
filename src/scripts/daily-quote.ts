import { dailyQuotes } from "@/data/daily-quotes";
export const QUOTE_TYPE_DELAY = 75;
export const QUOTE_HOLD_DELAY = 7000;
export function quoteDay(now = new Date()) {
	return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function dailyIndex(day: string, offset = 0) {
	const ordinal = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
	return (
		(((ordinal + offset) % dailyQuotes.length) + dailyQuotes.length) %
		dailyQuotes.length
	);
}
type QuoteController = { root: HTMLElement; start(): void; stop(): void };
const controllers = new WeakMap<HTMLElement, QuoteController>();
let active: QuoteController | undefined;
let listening = false;
function createController(root: HTMLElement): QuoteController {
	const text = root.querySelector<HTMLElement>("[data-quote-text]")!;
	const accessible = root.querySelector<HTMLElement>(
		"[data-quote-accessible]",
	)!;
	let day = quoteDay();
	let offset = 0;
	let chars: string[] = [];
	let position = 0;
	let started = false;
	let timer: number | undefined;
	let dueAt = 0;
	let remaining = 0;
	let pending: () => void = begin;
	function schedule(action: () => void, delay: number) {
		pending = action;
		remaining = delay;
		dueAt = Date.now() + delay;
		timer = window.setTimeout(() => {
			timer = undefined;
			remaining = 0;
			if (!root.isConnected || document.hidden) return;
			action();
		}, delay);
	}
	function begin() {
		const current = quoteDay();
		if (current !== day) {
			day = current;
			offset = 0;
		}
		chars = Array.from(dailyQuotes[dailyIndex(day, offset)].text);
		accessible.textContent = chars.join("");
		position = 0;
		text.textContent = "";
		root.dataset.day = day;
		root.dataset.state = "typing";
		type();
	}
	function type() {
		text.textContent = chars.slice(0, ++position).join("");
		if (position < chars.length) schedule(type, QUOTE_TYPE_DELAY);
		else {
			root.dataset.state = "holding";
			schedule(() => {
				offset = (offset + 1) % dailyQuotes.length;
				begin();
			}, QUOTE_HOLD_DELAY);
		}
	}
	return {
		root,
		start() {
			if (timer !== undefined || !root.isConnected || document.hidden) return;
			root.dataset.paused = "false";
			if (!started || quoteDay() !== day) {
				started = true;
				begin();
			} else schedule(pending, remaining);
		},
		stop() {
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timer = undefined;
				remaining = Math.max(0, dueAt - Date.now());
			}
			root.dataset.paused = "true";
		},
	};
}
export function initializeDailyQuote() {
	if (!listening) {
		document.addEventListener("visibilitychange", () =>
			document.hidden ? active?.stop() : active?.start(),
		);
		window.addEventListener("pagehide", () => active?.stop());
		window.addEventListener("pageshow", () => active?.start());
		listening = true;
	}
	const root = document.querySelector<HTMLElement>("[data-daily-quote]");
	if (active?.root === root) {
		active?.start();
		return;
	}
	active?.stop();
	active = undefined;
	if (!root) return;
	let controller = controllers.get(root);
	if (!controller) {
		controller = createController(root);
		controllers.set(root, controller);
	}
	active = controller;
	active.start();
}
