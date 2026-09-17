// The values an analyzer found: the fields its output.json actually filled.
//
// An analyzer's contract is usually that "" means "looked and did not find", so an
// output.json is mostly empty strings, and the handful that are not are the whole answer.
// Listed as those, by dotted path, rather than as the JSON. 0 and false are values a
// grammar chose, and stay. (From the TEG console's Browse and run, where this began.)
//
// PURE: no DOM.

export type FilledField = [path: string, value: string];

// Every filled value in a parsed output.json, as [dotted path, value]. A list of plain
// values is one field, joined; a list of objects is walked by index.
export function filledFields(output: unknown, prefix = ""): FilledField[] {
	if (output === null || output === undefined || output === "") return [];
	if (Array.isArray(output)) {
		if (output.every((v) => v === null || typeof v !== "object")) {
			const kept = output.filter((v) => v !== null && v !== "");
			return kept.length ? [[prefix, kept.join(", ")]] : [];
		}
		return output.flatMap((v, i) => filledFields(v, `${prefix}[${i}]`));
	}
	if (typeof output === "object") {
		return Object.entries(output as Record<string, unknown>)
			.flatMap(([k, v]) => filledFields(v, prefix ? `${prefix}.${k}` : k));
	}
	return [[prefix, String(output)]];
}

// output.json's text, parsed; or why it could not be.
export function readOutput(text: string | null | undefined): { output: unknown } | { error: string } {
	try {
		return { output: JSON.parse(String(text ?? "")) };
	} catch (err) {
		return { error: `output.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}
}
