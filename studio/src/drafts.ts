// Edits kept in this browser until they are downloaded or committed.
//
// One record per analyzer, holding only the files that differ from what was
// opened: saving a file back to its original text drops it from the record, so a
// draft is exactly "what you changed". localStorage is plenty for text-sized
// analyzers. When it is full or unavailable -- a private window, storage blocked
// by the browser -- save() returns false and the studio tells the person their
// edits are not being kept, rather than letting them find out after a reload.

export interface Draft {
	files: Record<string, string>;  // path inside the analyzer -> edited text
	saved: string;                  // ISO time of the last save
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIX = "nlp-studio:draft:";

export class DraftStore {
	constructor(private readonly storage: Store | null) {}

	// The browser's localStorage, or a store that keeps nothing when it cannot be used.
	static browser(): DraftStore {
		try {
			const storage = window.localStorage;
			storage.getItem(PREFIX);
			return new DraftStore(storage);
		} catch {
			return new DraftStore(null);
		}
	}

	get available(): boolean {
		return this.storage !== null;
	}

	load(analyzer: string): Draft | null {
		try {
			const raw = this.storage?.getItem(PREFIX + analyzer);
			if (!raw) return null;
			const draft = JSON.parse(raw) as Draft;
			return draft && typeof draft.files === "object" && draft.files !== null ? draft : null;
		} catch {
			return null;
		}
	}

	// Keep `text` as the draft of `path`. False when it could not be kept.
	save(analyzer: string, path: string, text: string, original: string, now = new Date()): boolean {
		if (!this.storage) return false;
		const files = { ...(this.load(analyzer)?.files ?? {}) };
		if (text === original) delete files[path];
		else files[path] = text;
		return this.write(analyzer, files, now);
	}

	// Forget one file's draft, or the whole analyzer's.
	discard(analyzer: string, path?: string): boolean {
		if (!this.storage) return false;
		if (path === undefined) return this.write(analyzer, {}, new Date());
		const files = { ...(this.load(analyzer)?.files ?? {}) };
		if (!(path in files)) return true;
		delete files[path];
		return this.write(analyzer, files, new Date());
	}

	// Every analyzer that has a draft.
	analyzers(): string[] {
		const names: string[] = [];
		try {
			for (let i = 0; this.storage && i < this.storage.length; i++) {
				const key = this.storage.key(i);
				if (key?.startsWith(PREFIX)) names.push(key.slice(PREFIX.length));
			}
		} catch {
			// Storage went away mid-listing; what was read is still right.
		}
		return names.sort();
	}

	private write(analyzer: string, files: Record<string, string>, now: Date): boolean {
		try {
			if (Object.keys(files).length) {
				this.storage!.setItem(PREFIX + analyzer, JSON.stringify({ files, saved: now.toISOString() } satisfies Draft));
			} else {
				this.storage!.removeItem(PREFIX + analyzer);
			}
			return true;
		} catch {
			return false;
		}
	}
}
