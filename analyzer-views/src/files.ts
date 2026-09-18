// Which of an analyzer's files are listed where, and how their sizes read.
//
// PURE: no DOM.

// A file of the analyzer: its path inside the analyzer (spec/..., kb/..., input/...),
// its size when the host knows it, and, for a knowledge-base file, what it holds
// (kbDescription of its text) to show when the mouse is over it.
export interface AnalyzerFile {
	path: string;
	bytes?: number;
	description?: string;
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

// A knowledge-base file's name in the list: its path under kb/user/, where an analyzer's
// own files live -- "colors.dict" rather than "kb/user/colors.dict".
export function kbLabel(path: string): string {
	return path.replace(/^kb\/(user\/)?/, "");
}

// What a .dict or .kbb file holds, as its author says in the comment at the top of it: the
// opening paragraph of '#' or /* */ comment lines, as the extension's KNOWLEDGE BASE view
// shows it on mouse-over (kbView.ts fileDescription). A bare '#' ends the paragraph; a '/*'
// alone on the line opening a block comment is stepped over. "" when there is none.
//
// Only the head is read: en-full.kbb is 10 MB, and the description is at the top.
const DESCRIPTION_HEAD = 4096;
const DESCRIPTION_LINES = 8;

export function kbDescription(text: string | null | undefined): string {
	const all = String(text ?? "");
	const lines = all.slice(0, DESCRIPTION_HEAD).split(/\r?\n/);
	if (all.length > DESCRIPTION_HEAD) lines.pop();     // cut mid-line: not whole
	const out: string[] = [];
	let open = false;       // inside a /* */ comment begun on an earlier line
	for (const line of lines) {
		if (out.length >= DESCRIPTION_LINES) break;
		const trimmed = line.trim();
		if (open || trimmed.startsWith("/*")) {
			// A block-comment line counts only when nothing follows its close.
			const close = trimmed.indexOf("*/", open ? 0 : 2);
			if (close >= 0 && trimmed.slice(close + 2).trim()) break;
			open = close < 0;
		} else if (!trimmed.startsWith("#")) {
			break;
		}
		const words = stripCommentMarkers(trimmed);
		if (!words) {
			if (!out.length) continue;      // '/*' on a line of its own opens the block
			break;                          // a marker-only line closes the paragraph
		}
		out.push(words);
	}
	return out.join("\n");
}

// One comment line without its markers: '#', '/*', '*/', and the '*' block comments'
// continuation lines are often drawn with.
function stripCommentMarkers(line: string): string {
	let text = line;
	if (text.startsWith("/*")) text = text.slice(2);
	if (text.endsWith("*/")) text = text.slice(0, -2);
	return text.replace(/^[#*\s]+/, "").trim();
}

// A size for a list: "3 KB", "1.2 MB". Unknown or empty prints nothing rather than
// claiming "0 KB".
export function fileSize(bytes: number | null | undefined): string {
	if (!bytes) return "";
	return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
