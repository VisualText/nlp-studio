// Which of an analyzer's files are listed where, and how their sizes read.
//
// PURE: no DOM.

// A file of the analyzer: its path inside the analyzer (spec/..., kb/..., input/...),
// and its size when the host knows it.
export interface AnalyzerFile {
	path: string;
	bytes?: number;
}

export function toFile(file: string | AnalyzerFile): AnalyzerFile {
	return typeof file === "string" ? { path: file } : file;
}

// The knowledge-base files a person works on: dictionaries and .kbb files. The .kb files
// (hier.kb, word.kb, attr.kb, phr.kb) are the engine's own record of the knowledge base;
// they travel with the analyzer -- to runs, downloads and commits -- but are never listed.
export function shownInKnowledgeBase(path: string): boolean {
	return path.startsWith("kb/") && /\.(dict|kbb)$/i.test(path);
}

// A size for a list: "3 KB", "1.2 MB". Unknown or empty prints nothing rather than
// claiming "0 KB".
export function fileSize(bytes: number | null | undefined): string {
	if (!bytes) return "";
	return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
