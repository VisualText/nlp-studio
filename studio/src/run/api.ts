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
	tree?: string | null;             // output/final.tree
	problems?: RunProblem[];
	log?: string[];
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

export async function runAnalyzer(files: Record<string, string>, text: string, base = "api"): Promise<RunResult> {
	let res: Response;
	try {
		res = await fetch(`${base}/run`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ files, text }),
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
