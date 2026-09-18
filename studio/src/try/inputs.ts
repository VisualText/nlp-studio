// The texts an analyzer ships to run on: every file under its input/.
//
// PURE: no DOM. An analyzer can carry several -- corporate has four, in two folders --
// and the try page offers them all, starting on the one copy-analyzers.mjs chose.

export interface InputText {
	path: string;    // input/Dev/Sold.txt, as the analyzer has it
	label: string;   // Dev/Sold.txt: what the picker shows
}

const PREFIX = "input/";

// The texts, in path order. The one to start on is `chosen` when the analyzer has it,
// else the first; null when there are none, and the page starts with an empty box.
export function inputTexts(files: Iterable<string>, chosen: string | null):
	{ texts: InputText[]; start: string | null } {
	const texts = [...files]
		.filter((path) => path.startsWith(PREFIX) && path.length > PREFIX.length)
		.sort((a, b) => a.localeCompare(b))
		.map((path) => ({ path, label: path.slice(PREFIX.length) }));
	const start = texts.some((t) => t.path === chosen) ? chosen : texts[0]?.path ?? null;
	return { texts, start };
}
