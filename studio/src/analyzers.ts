// The analyzers the studio can open: the list, their files, and their pass order.
//
// PURE apart from fetch: public/analyzers/index.json is written by
// scripts/copy-samples.mjs, and each file is fetched from beside it.

export interface AnalyzerEntry {
	name: string;           // a slug, safe in a URI
	title: string;          // as the analyzer's folder is named
	origin: "sample" | "template";
	files: string[];        // paths inside the analyzer: spec/..., kb/..., input/...
}

// Every file the language server sees sits under this one workspace folder.
// Opening another analyzer replaces the files under it, rather than adding a
// second folder, so the index never mixes two analyzers' declarations -- and
// every template carries its own copy of KBFuncs.nlp.
export const ROOT_URI = "memory:/analyzers";

export function fileUri(analyzer: string, path: string): string {
	return `${ROOT_URI}/${analyzer}/${path}`;
}

// The path inside its analyzer of a URI from fileUri, or undefined for any other URI.
export function pathOf(uri: string, analyzer: string): string | undefined {
	const base = `${ROOT_URI}/${analyzer}/`;
	return uri.startsWith(base) ? uri.slice(base.length) : undefined;
}

export interface Pass {
	n: number | null;       // position among the passes that run; null when switched off
	kind: string;           // nlp, pat, rec, tokenize, dicttokz, folder, stub, ...
	name: string;
	active: boolean;
	comment: string;
	file: string | null;    // spec/<name>.nlp or .pat when the analyzer has it
}

// spec/analyzer.seq as passes, in the order the engine runs them. A leading "/"
// switches a pass off; `end` lines close a folder or stub and are not passes.
export function passes(seq: string, files: string[]): Pass[] {
	const have = new Set(files);
	const out: Pass[] = [];
	let n = 0;
	for (const raw of seq.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith("/*")) continue;
		const active = !line.startsWith("/");
		const [body, ...rest] = line.replace(/^\/+/, "").split("#");
		const [kind = "", name = ""] = body.trim().split(/\s+/);
		if (!kind || kind === "end") continue;
		const file = [`spec/${name}.nlp`, `spec/${name}.pat`].find((f) => have.has(f)) ?? null;
		const counted = active && kind !== "folder" && kind !== "stub";
		out.push({ n: counted ? ++n : null, kind, name, active, comment: rest.join("#").trim(), file });
	}
	return out;
}

export async function loadIndex(base = "analyzers"): Promise<AnalyzerEntry[]> {
	const res = await fetch(`${base}/index.json`);
	if (!res.ok) throw new Error(`analyzers/index.json: HTTP ${res.status} -- run npm run samples`);
	return ((await res.json()) as { analyzers: AnalyzerEntry[] }).analyzers;
}

export async function loadFiles(entry: AnalyzerEntry, base = "analyzers"): Promise<Map<string, string>> {
	const texts = await Promise.all(entry.files.map(async (f) => {
		const url = `${base}/${entry.name}/${f.split("/").map(encodeURIComponent).join("/")}`;
		const res = await fetch(url);
		return [f, res.ok ? await res.text() : ""] as const;
	}));
	return new Map(texts);
}
