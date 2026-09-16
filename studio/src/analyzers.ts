// The analyzers the studio can open: the list, and their files. How their sequence and
// knowledge base are listed is @visualtext/analyzer-views (../analyzer-views).
//
// PURE apart from fetch: public/analyzers/index.json is written by
// scripts/copy-samples.mjs, and each file is fetched from beside it.

export interface AnalyzerEntry {
	name: string;           // a slug, safe in a URI
	title: string;          // as the analyzer's folder is named
	origin: "sample" | "template" | "github";
	files: string[];        // paths inside the analyzer: spec/..., kb/..., input/...
	source?: GitHubSource;  // where a GitHub analyzer's files are read from
}

export interface GitHubSource {
	repo: string;           // owner/name
	ref: string;            // the branch it was opened from
	commit: string;         // the sha its files are read at
	folder: string;         // "" at the top of the repository
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

export async function loadIndex(base = "analyzers"): Promise<AnalyzerEntry[]> {
	const res = await fetch(`${base}/index.json`);
	if (!res.ok) throw new Error(`analyzers/index.json: HTTP ${res.status} -- run npm run samples`);
	return ((await res.json()) as { analyzers: AnalyzerEntry[] }).analyzers;
}

export async function loadFiles(entry: AnalyzerEntry, base = "analyzers"): Promise<Map<string, string>> {
	if (entry.source) {
		// Through the studio server, which holds the GitHub token (github/api.ts).
		const { analyzerFiles } = await import("./github/api");
		return analyzerFiles(entry.source.repo, entry.source.commit, entry.source.folder);
	}
	const texts = await Promise.all(entry.files.map(async (f) => {
		const url = `${base}/${entry.name}/${f.split("/").map(encodeURIComponent).join("/")}`;
		const res = await fetch(url);
		return [f, res.ok ? await res.text() : ""] as const;
	}));
	return new Map(texts);
}
