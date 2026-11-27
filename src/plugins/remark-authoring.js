import { toString as mdastToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

const names = new Set(["steps", "step", "tabs", "tab", "codegroup"]);

// Extend Firefly's existing remark-directive pipeline; ordinary directives and
// callouts keep their original handling in remark-directive-rehype.js.
export function transformAuthoringDirectives(tree, file) {
	visit(tree, (node, _index, parent) => {
		if (node.type !== "containerDirective" || !names.has(node.name)) return;
		const fail = (message) => file.fail(`Authoring: ${message}`, node);
		const labelNode = node.children[0]?.data?.directiveLabel
			? node.children[0]
			: undefined;
		const label = labelNode ? mdastToString(labelNode).trim() : "";
		const body = labelNode ? node.children.slice(1) : node.children;
		node.data ||= {};
		const data = node.data;
		data.authoring = true;

		if (node.name === "step" || node.name === "tab") {
			const expected = node.name === "step" ? ["steps"] : ["tabs", "codegroup"];
			if (!expected.includes(parent?.name))
				fail(`${node.name} must be directly inside ${expected.join(" or ")}.`);
			if (!label) fail(`${node.name} needs a non-empty [title].`);
			if (!body.length) fail(`${node.name}[${label}] needs content.`);
			if (parent?.name === "codegroup") {
				let codeCount = 0;
				visit(node, "code", () => {
					codeCount++;
				});
				if (codeCount !== 1)
					fail(`codegroup tab[${label}] needs exactly one fenced code block.`);
			}
			data.hName = node.name === "step" ? "li" : "section";
			data.hProperties =
				node.name === "step"
					? { className: ["authoring-step"] }
					: {
							className: ["authoring-tab-panel"],
							"data-tab-panel": "",
							"data-label": label,
						};
			labelNode.data = {
				hName: "p",
				hProperties: {
					className: [
						node.name === "step"
							? "authoring-step-title"
							: "authoring-tab-fallback-title",
					],
				},
			};
			return;
		}

		const childName = node.name === "steps" ? "step" : "tab";
		if (
			!body.length ||
			body.some(
				(child) =>
					child.type !== "containerDirective" || child.name !== childName,
			)
		) {
			fail(
				`${node.name} must contain only one or more ${childName}[title] containers. Use more colons on the outer container.`,
			);
		}
		node.children = body;
		data.hName = node.name === "steps" ? "ol" : "div";
		data.hProperties =
			node.name === "steps"
				? { className: ["authoring-steps"], "aria-label": label || "操作步骤" }
				: {
						className: ["authoring-tabs"],
						"data-authoring-tabs":
							node.name === "codegroup" ? "code" : "content",
						"data-label":
							label || (node.name === "codegroup" ? "代码选项" : "内容选项"),
					};
	});
}
