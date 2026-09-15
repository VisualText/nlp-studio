// The studio server's GitHub API (server/app.py): signing in, and the analyzers in
// repositories a person can reach.
//
// The page never holds a GitHub token. The server keeps it in the session behind an
// HttpOnly cookie and makes these calls itself, so nothing an analyzer file contains
// can get at it.

export interface Account {
	signIn: boolean;        // the server signs people in with GitHub
	github: boolean;        // the server can reach GitHub at all (sign-in, or a development token)
	signedIn: boolean;
	login: string | null;
}

export interface Repository {
	fullName: string;       // owner/name
	private: boolean;
	defaultBranch: string;
}

export interface FoundAnalyzer {
	folder: string;         // "" for an analyzer at the top of the repository
	title: string;
	files: string[];        // paths inside the analyzer: spec/..., kb/..., input/...
}

export interface RepoAnalyzers {
	repo: string;
	ref: string;
	commit: string;         // the full sha the analyzers were found at
	analyzers: FoundAnalyzer[];
}

// A GitHub analyzer opened before, kept so it can be reopened after a reload.
export interface RecentAnalyzer {
	repo: string;
	ref: string;
	folder: string;
	title: string;
}

export class GitHubApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

export const SIGN_IN_URL = "api/auth/login";

async function getJson<T>(path: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, { cache: "no-store" });
	} catch {
		throw new GitHubApiError("The studio server did not answer.", 0);
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		// Not JSON: something other than the studio server answered.
	}
	if (!res.ok || body === null) {
		throw new GitHubApiError((body as { message?: string } | null)?.message ?? `HTTP ${res.status}`, res.status);
	}
	return body as T;
}

const NO_ACCOUNT: Account = { signIn: false, github: false, signedIn: false, login: null };

export async function account(): Promise<Account> {
	try {
		return await getJson<Account>("api/auth/me");
	} catch {
		return NO_ACCOUNT;
	}
}

export async function signOut(): Promise<void> {
	await fetch("api/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function repositories(): Promise<Repository[]> {
	return (await getJson<{ repositories: Repository[] }>("api/github/repos")).repositories;
}

export function analyzersIn(repo: string, ref?: string): Promise<RepoAnalyzers> {
	const query = new URLSearchParams({ repo });
	if (ref) query.set("ref", ref);
	return getJson<RepoAnalyzers>(`api/github/analyzers?${query}`);
}

export async function analyzerFiles(repo: string, commit: string, folder: string): Promise<Map<string, string>> {
	const query = new URLSearchParams({ repo, commit, folder });
	const body = await getJson<{ files: Record<string, string> }>(`api/github/analyzer?${query}`);
	return new Map(Object.entries(body.files));
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// A name safe in a URI and stable across commits, so drafts follow the analyzer, not the sha.
export function entryName(repo: string, ref: string, folder: string): string {
	return `github-${slug(repo)}-${slug(ref)}-${slug(folder) || "top"}`;
}

const RECENT = "nlp-studio:github-recent";

export function recent(): RecentAnalyzer[] {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT) ?? "[]");
		return Array.isArray(list) ? list.filter((r) => r && typeof r.repo === "string" && typeof r.folder === "string") : [];
	} catch {
		return [];
	}
}

export function remember(item: RecentAnalyzer): void {
	try {
		const others = recent().filter((r) => !(r.repo === item.repo && r.ref === item.ref && r.folder === item.folder));
		localStorage.setItem(RECENT, JSON.stringify([item, ...others].slice(0, 12)));
	} catch {
		// Storage blocked or full: the analyzer still opens, it is just not remembered.
	}
}
