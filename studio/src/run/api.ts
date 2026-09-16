// The run server's API (server/app.py): one analyzer run per request.
//
// Every outcome of a run -- ran, did not build, timed out, the engine stopped,
// refused -- comes back as a RunResult with a status and a sentence to show. So
// does not reaching a run server at all ("unavailable"): the studio is a static
// site, and one deployed without the server still edits, it just cannot run.

export type RunStatus =
	"ok" | "failed" | "timeout" | "crashed" | "rejected" | "busy" | "invalid" | "unauthorized" | "unavailable";

export interface RunProblem {
	file: string | null;  // spec/<pass>.nlp, or null when the engine names no pass
	pass: number;
	line: number;
	message: string;
}

export interface RunResult {
	status: RunStatus;
	message: string;
	ms?: number;
	engine?: string | null;
	output?: Record<string, string>;  // files the analyzer wrote into output/
	tree?: string | null;             // output/final.tree, when small enough to send inline
	trees?: RunTrees | null;          // the run's trees, kept by the server to open one at a time
	problems?: RunProblem[];
	log?: string[];
}

export interface TreeFile {
	name: string;                     // final.tree, or ana001.tree ... after each pass (Debug)
	size: number;                     // bytes
	pass: number | null;              // the pass it was written after; null for final.tree
	passName: string | null;
	file: string | null;              // that pass's spec/ file, if it has one
}

export interface RunTrees {
	run: string;                      // the id to ask for them by
	files: TreeFile[];
	skipped: string[];                // trees too large to keep
}

// The files a run wrote, with their sizes in bytes, as <nlp-output> lists them.
export function outputFiles(run: Pick<RunResult, "output"> | undefined): { path: string; bytes: number }[] {
	const encoder = new TextEncoder();
	return Object.entries(run?.output ?? {}).map(([path, text]) => ({ path, bytes: encoder.encode(text).length }));
}

// One of a run's trees, as text. It is kept on the server for a while after the run.
export async function fetchTree(run: string, name: string, base = "api"): Promise<string> {
	let res: Response;
	try {
		res = await fetch(`${base}/run/tree?${new URLSearchParams({ run, name })}`, { cache: "no-store" });
	} catch {
		throw new Error("The run server did not answer.");
	}
	if (res.ok) return res.text();
	let message = `HTTP ${res.status}`;
	try {
		message = ((await res.json()) as { message?: string }).message ?? message;
	} catch {
		// Not JSON.
	}
	throw new Error(message);
}

export interface ServerHealth {
	ok: true;
	engine: string | null;
	timeout: number;
	maxRuns: number;
}

const NO_SERVER = "No run server answered. Start one with: python server/app.py (see the README).";

export async function serverHealth(base = "api"): Promise<ServerHealth | null> {
	try {
		const res = await fetch(`${base}/health`, { cache: "no-store" });
		if (!res.ok) return null;
		const body = (await res.json()) as Partial<ServerHealth>;
		return body?.ok ? (body as ServerHealth) : null;
	} catch {
		// A static host answers index.html here, which is not JSON: no server.
		return null;
	}
}

// `develop` is the Debug checkbox: the engine also writes the tree after every pass.
export async function runAnalyzer(files: Record<string, string>, text: string,
	options: { develop?: boolean } = {}, base = "api"): Promise<RunResult> {
	let res: Response;
	try {
		res = await fetch(`${base}/run`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ files, text, develop: options.develop === true }),
		});
	} catch {
		return { status: "unavailable", message: NO_SERVER };
	}
	try {
		const body = (await res.json()) as Partial<RunResult>;
		if (typeof body.status === "string" && typeof body.message === "string") return body as RunResult;
	} catch {
		// Not JSON: something other than the run server answered.
	}
	return { status: "unavailable", message: `${NO_SERVER} (HTTP ${res.status})` };
}
