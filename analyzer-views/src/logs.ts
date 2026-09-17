// The engine's log, read as the NLP++ extension's LOGGING view reads it: problems that
// name a pass and a line, and the lines around them.
//
// The engine writes make_ana.log (building the analyzer) and err.log (running it) as lines
// of "<pass> <line> [message]": pass 0 is the analyzer as a whole. The same reading as
// NLP Studio's run server (studio/server/nlp_run.py parse_log), for pages that are handed
// the log's text rather than problems.
//
// PURE: no DOM.

import { type Pass, passes } from "./sequence.js";

export interface Problem {
	file: string | null;    // the pass's spec/ file, or null when the engine names no pass or it has none
	pass: number;           // 0 for the analyzer as a whole
	line: number;
	message: string;
}

const LOG_LINE = /^\s*(\d+)\s+(\d+)\s+\[(.*)\]\s*$/;
// The engine's timings and date stamp are written the same way, and are not problems.
const NOT_A_PROBLEM = /^(Date:|[\w ]+ time=)/;

// The problems in a log, each in its pass's file. `sequence` is the pass list (from
// passes(), or the text of spec/analyzer.seq with the analyzer's files) that turns a pass
// number into a file.
export function problemsIn(log: string | null | undefined, sequence: Pass[]): Problem[] {
	const fileOf = new Map(sequence.filter((p) => p.n !== null).map((p) => [p.n!, p.file]));
	const problems: Problem[] = [];
	for (const raw of String(log ?? "").split(/\r?\n/)) {
		const m = LOG_LINE.exec(raw);
		if (!m) continue;
		const pass = Number(m[1]);
		const line = Number(m[2]);
		const message = m[3].trim();
		if (!message || NOT_A_PROBLEM.test(message)) continue;
		problems.push({ file: pass ? fileOf.get(pass) ?? null : null, pass, line, message });
	}
	return problems;
}

// problemsIn, from the text of spec/analyzer.seq and the analyzer's file paths.
export function problemsInLog(log: string | null | undefined, seq: string, files: Iterable<string>): Problem[] {
	return problemsIn(log, passes(seq, files));
}

// Where a problem is, as the log lists it: "spec/funcs.nlp:12", "pass 4", or "analyzer".
export function problemWhere(problem: Pick<Problem, "file" | "line" | "pass">): string {
	return problem.file ? `${problem.file}:${problem.line}` : problem.pass ? `pass ${problem.pass}` : "analyzer";
}

// A log's text as lines, without the blank ones.
export function logLines(log: string | readonly string[] | null | undefined): string[] {
	const lines = typeof log === "string" ? log.split(/\r?\n/) : [...(log ?? [])];
	return lines.filter((l) => l.trim() !== "");
}
