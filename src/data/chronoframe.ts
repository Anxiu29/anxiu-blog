export type ChronoframeEntry = {
	state: "unconfigured" | "configured" | "invalid";
	url: string | null;
};

/** An explicit local-only allowlist; URL normalization must not widen access. */
export function getChronoframeEntry(raw?: string): ChronoframeEntry {
	if (!raw?.trim()) return { state: "unconfigured", url: null };
	if (raw === "http://127.0.0.1:3000/" || raw === "http://localhost:3000/")
		return { state: "configured", url: raw };
	return { state: "invalid", url: null };
}
