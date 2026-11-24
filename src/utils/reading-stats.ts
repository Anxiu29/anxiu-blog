/** Rough reading time for mixed Chinese/English Markdown; never a view count. */
export function getReadingStats(markdown = "") {
	const text = markdown
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]*>/g, " ")
		.replace(/https?:\/\/\S+/g, " ");
	const characters = (text.match(/\p{Script=Han}/gu) || []).length;
	const words = (text.match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g) || [])
		.length;
	return {
		count: characters + words,
		minutes: Math.max(1, Math.ceil(characters / 400 + words / 200)),
	};
}
