import { describe, expect, it } from "vitest";
import { DraftStore } from "../src/drafts";

// A Storage that behaves like the browser's, and can be made full.
class MemoryStorage {
	private readonly items = new Map<string, string>();
	full = false;
	get length() { return this.items.size; }
	key(i: number) { return [...this.items.keys()][i] ?? null; }
	getItem(k: string) { return this.items.get(k) ?? null; }
	setItem(k: string, v: string) {
		if (this.full) throw new DOMException("quota", "QuotaExceededError");
		this.items.set(k, v);
	}
	removeItem(k: string) { this.items.delete(k); }
}

describe("DraftStore", () => {
	const when = new Date("2026-09-15T12:00:00Z");

	it("keeps only the files that differ from what was opened", () => {
		const store = new DraftStore(new MemoryStorage());
		expect(store.save("hello", "spec/a.nlp", "edited", "original", when)).toBe(true);
		expect(store.save("hello", "spec/b.nlp", "same", "same", when)).toBe(true);
		expect(store.load("hello")).toEqual({ files: { "spec/a.nlp": "edited" }, saved: "2026-09-15T12:00:00.000Z" });
	});

	it("drops a file edited back to its original, and the record with its last file", () => {
		const store = new DraftStore(new MemoryStorage());
		store.save("hello", "spec/a.nlp", "edited", "original");
		store.save("hello", "spec/a.nlp", "original", "original");
		expect(store.load("hello")).toBeNull();
		expect(store.analyzers()).toEqual([]);
	});

	it("keeps each analyzer apart and lists those with drafts", () => {
		const store = new DraftStore(new MemoryStorage());
		store.save("zeta", "spec/a.nlp", "z", "");
		store.save("alpha", "spec/a.nlp", "a", "");
		expect(store.analyzers()).toEqual(["alpha", "zeta"]);
		expect(store.load("alpha")?.files).toEqual({ "spec/a.nlp": "a" });
	});

	it("discards one file or the whole analyzer", () => {
		const store = new DraftStore(new MemoryStorage());
		store.save("hello", "spec/a.nlp", "1", "");
		store.save("hello", "spec/b.nlp", "2", "");
		store.discard("hello", "spec/a.nlp");
		expect(Object.keys(store.load("hello")!.files)).toEqual(["spec/b.nlp"]);
		store.discard("hello");
		expect(store.load("hello")).toBeNull();
	});

	it("says so when the edit could not be kept", () => {
		const storage = new MemoryStorage();
		const store = new DraftStore(storage);
		storage.full = true;
		expect(store.save("hello", "spec/a.nlp", "edited", "original")).toBe(false);
		expect(new DraftStore(null).save("hello", "spec/a.nlp", "edited", "original")).toBe(false);
		expect(new DraftStore(null).available).toBe(false);
	});

	it("treats a damaged record as no draft", () => {
		const storage = new MemoryStorage();
		storage.setItem("nlp-studio:draft:hello", "{not json");
		expect(new DraftStore(storage).load("hello")).toBeNull();
	});
});
