// Opening the studio from another page: an analyzer named in the link, and a text
// handed over by the page that opened it.
//
// WHY. A page that shows texts -- a corpus of real documents, say -- wants a button
// that opens one of them in the studio, in the analyzer that reads it, ready to run
// and edit. The analyzer can be named in the link. The TEXT cannot: it may be a
// client's document, and a URL is written into browser history, server logs and
// referrers. So the text travels by postMessage from the window that opened the
// studio, and only from an origin the studio's server allows (NLP_STUDIO_OPENERS,
// reported by /api/health).
//
// THE LINK:  ?repo=owner/name&ref=branch&folder=path/to/analyzer&handoff=1
//   repo, ref, folder  open that analyzer from GitHub, as "Open from GitHub" would
//   handoff=1          wait for a text from the opener
//
// THE EXCHANGE:
//   studio -> opener   {type: "nlp-studio:ready"}                       (target "*":
//                      it carries nothing, and says only that the studio is listening)
//   opener -> studio   {type: "nlp-studio:input", name: "x.txt", text: "..."}
//   studio -> opener   {type: "nlp-studio:received", name}               (to its origin)
//
// A HANDED-IN TEXT IS NEVER KEPT. It becomes input/<name> for as long as the page is
// open: never a draft in this browser's storage, never in a commit, never in the
// Download zip. Closing the tab is the end of it. The studio says so beside the file.
//
// Signing in with GitHub leaves the page and comes back to its plain address, so the
// link -- the analyzer, never the text -- is kept in sessionStorage across it.

export interface OpenLink {
	repo: string;
	ref: string;
	folder: string;
	handoff: boolean;
}

export const READY = "nlp-studio:ready";
export const INPUT = "nlp-studio:input";
export const RECEIVED = "nlp-studio:received";
// A text is a document, not an analyzer: 2 MB is far past any resume or form.
export const MAX_TEXT = 2 * 1024 * 1024;

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9._\/-]{1,200}$/;
const FOLDER = /^[A-Za-z0-9._\/-]{0,300}$/;
const KEPT = "nlp-studio:open-link";

// The analyzer a link names, or null if it names none or names one badly.
export function parseOpenLink(search: string): OpenLink | null {
	const q = new URLSearchParams(search);
	const repo = q.get("repo") ?? "";
	if (!REPO.test(repo)) return null;
	const ref = q.get("ref") ?? "";
	const folder = (q.get("folder") ?? "").replace(/^\/+|\/+$/g, "");
	if (ref && !REF.test(ref)) return null;
	if (!FOLDER.test(folder) || folder.split("/").includes("..")) return null;
	return { repo, ref, folder, handoff: q.get("handoff") === "1" };
}

// Keep a link across the sign-in round trip; take it back once, afterwards.
export function keepLink(link: OpenLink, store: Pick<Storage, "setItem"> | null = session()): void {
	try {
		store?.setItem(KEPT, JSON.stringify(link));
	} catch {
		// Storage blocked: the person opens the analyzer by hand after signing in.
	}
}

export function takeLink(store: Pick<Storage, "getItem" | "removeItem"> | null = session()): OpenLink | null {
	try {
		const raw = store?.getItem(KEPT);
		store?.removeItem(KEPT);
		if (!raw) return null;
		const link = JSON.parse(raw) as OpenLink;
		return link && REPO.test(link.repo) ? link : null;
	} catch {
		return null;
	}
}

function session(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

// A handed-in text's file name: letters, digits, dot, dash and underscore, ending in
// .txt. Anything else is replaced, so a name can never reach outside input/.
export function inputName(name: unknown): string {
	let n = typeof name === "string" ? name : "";
	n = n.split(/[\\/]/).pop() ?? "";
	n = n.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80);
	if (!n) n = "handed-in";
	if (!n.toLowerCase().endsWith(".txt")) n += ".txt";
	return n;
}

export interface HandedText {
	name: string;
	text: string;
}

// A message from the opener, as a text to take -- or null if it is not one, comes from
// anywhere but the opener at an allowed origin, or is too large.
export function acceptInput(
	event: Pick<MessageEvent, "data" | "origin" | "source">,
	opener: unknown,
	allowed: readonly string[],
): HandedText | null {
	if (!opener || event.source !== opener) return null;
	if (!allowed.includes(event.origin)) return null;
	const data = event.data as { type?: unknown; name?: unknown; text?: unknown } | null;
	if (!data || data.type !== INPUT || typeof data.text !== "string") return null;
	if (data.text.length > MAX_TEXT) return null;
	return { name: inputName(data.name), text: data.text.replace(/\r\n?/g, "\n") };
}

// Tell the opener the studio is listening, and hand each text it sends to `take`.
// Returns a function that stops listening.
export function listenForHandoff(allowed: readonly string[], take: (t: HandedText) => void): () => void {
	const opener = window.opener as Window | null;
	if (!opener || !allowed.length) return () => undefined;
	const onMessage = (event: MessageEvent) => {
		const handed = acceptInput(event, opener, allowed);
		if (!handed) return;
		take(handed);
		(event.source as Window).postMessage({ type: RECEIVED, name: handed.name }, event.origin);
	};
	window.addEventListener("message", onMessage);
	opener.postMessage({ type: READY }, "*");
	return () => window.removeEventListener("message", onMessage);
}
