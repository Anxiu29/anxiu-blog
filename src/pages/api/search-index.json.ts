import { getJournalSearchIndex } from "@/data/journal-search";
export async function GET() {
	const { records } = await getJournalSearchIndex();
	return new Response(JSON.stringify(records), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}
