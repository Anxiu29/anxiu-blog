import assert from "node:assert/strict";
import { enhanceAuthoringGroup } from "../src/scripts/authoring-tabs.mjs";

// Small DOM port for controller behavior; this does not claim browser/layout QA.
class Element {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.hidden = false; this.className = ""; this.textContent = ""; }
  append(...nodes) { nodes.forEach((node) => { this.children.push(node); node.parentElement = this; }); }
  prepend(node) { this.children.unshift(node); node.parentElement = this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  async fire(name, properties = {}) { const event = { target: this, preventDefault() {}, ...properties }; for (const listener of this.listeners[name] || []) await listener(event); }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.selected = true; }
  matches(selector) {
    if (selector === "[data-tab-panel]") return this.getAttribute("data-tab-panel") !== null;
    if (selector === "[data-code]") return this.getAttribute("data-code") !== null;
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return all;
    if (selector === "pre code") return all.filter((node) => node.tagName === "code" && node.parentElement?.tagName === "pre");
    if (selector === ".ec-line .code") return [];
    return all.filter((node) => node.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Document {
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return this.root?.querySelectorAll("*").find((node) => node.id === id) || null; }
}
function fixture() {
  const doc = new Document();
  const group = doc.createElement("div"); doc.root = group;
  group.dataset.authoringTabs = "code"; group.dataset.label = "安装方式";
  for (const [label, code] of [["pnpm", "pnpm install\x7fpnpm dev"], ["npm", "npm install"]]) {
    const panel = doc.createElement("section"); panel.dataset.label = label; panel.setAttribute("data-tab-panel", "");
    const pre = doc.createElement("pre"); const codeNode = doc.createElement("code"); codeNode.textContent = "1gutter text must not copy"; pre.append(codeNode);
    const native = doc.createElement("button"); native.setAttribute("data-code", code); panel.append(pre, native); group.append(panel);
  }
  return { doc, group };
}
const { doc, group } = fixture();
const copied = [];
enhanceAuthoringGroup(group, async (value) => { copied.push(value); });
const tabs = group.querySelectorAll("button").filter((node) => node.getAttribute("role") === "tab");
const panels = group.children.filter((node) => node.matches("[data-tab-panel]"));
const copy = group.querySelectorAll("button").find((node) => node.className === "authoring-copy");
assert.equal(tabs.length, 2);
assert.deepEqual(panels.map((node) => node.hidden), [false, true]);
assert.equal(tabs[0].getAttribute("aria-selected"), "true");
assert.equal(tabs[1].tabIndex, -1);
assert.equal(panels[0].getAttribute("aria-labelledby"), tabs[0].id);
assert.equal(tabs[0].getAttribute("aria-controls"), panels[0].id);
await copy.fire("click");
assert.deepEqual(copied, ["pnpm install\npnpm dev"]);
await tabs[0].fire("keydown", { key: "ArrowRight" });
assert.deepEqual(panels.map((node) => node.hidden), [true, false]);
assert.equal(tabs[1].getAttribute("aria-selected"), "true");
assert.equal(doc.activeElement, tabs[1]);
await copy.fire("click");
assert.deepEqual(copied, ["pnpm install\npnpm dev", "npm install"]);
await tabs[1].fire("keydown", { key: "Home" }); assert.equal(doc.activeElement, tabs[0]);
await tabs[0].fire("keydown", { key: "End" }); assert.equal(doc.activeElement, tabs[1]);
await tabs[1].fire("keydown", { key: "ArrowRight" }); assert.equal(doc.activeElement, tabs[0]);
await tabs[0].fire("keydown", { key: "ArrowLeft" }); assert.equal(doc.activeElement, tabs[1]);
await tabs[0].fire("click"); assert.equal(tabs[0].getAttribute("aria-selected"), "true");
enhanceAuthoringGroup(group);
assert.equal(group.querySelectorAll("button").filter((node) => node.getAttribute("role") === "tab").length, 2, "repeat init duplicated tabs");
const failure = fixture();
enhanceAuthoringGroup(failure.group, async () => { throw new Error("clipboard blocked"); });
const failedCopy = failure.group.querySelectorAll("button").find((node) => node.className === "authoring-copy");
await failedCopy.fire("click");
const manual = failure.group.querySelector("textarea");
assert.equal(manual.value, "pnpm install\npnpm dev");
assert.equal(manual.hidden, false); assert.equal(manual.selected, true); assert.equal(failure.doc.activeElement, manual);
const failureTabs = failure.group.querySelectorAll("button").filter((node) => node.getAttribute("role") === "tab");
await failureTabs[1].fire("click"); assert.equal(manual.hidden, true); assert.equal(manual.value, "");
const pending = fixture(); let rejectCopy;
enhanceAuthoringGroup(pending.group, () => new Promise((_resolve, reject) => { rejectCopy = reject; }));
const pendingCopy = pending.group.querySelectorAll("button").find((node) => node.className === "authoring-copy");
const task = pendingCopy.fire("click");
const pendingTabs = pending.group.querySelectorAll("button").filter((node) => node.getAttribute("role") === "tab");
await pendingTabs[1].fire("click"); rejectCopy(new Error("late denial")); await task;
assert.equal(pending.group.querySelector("textarea").hidden, true, "late failure revealed old tab code");
console.log("Authoring controller: ARIA, roving focus, arrows/Home/End, current-code copying, clipboard fallback, stale requests, and repeat init passed.");
