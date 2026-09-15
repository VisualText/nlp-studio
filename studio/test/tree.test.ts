import { describe, expect, it } from "vitest";
import { displayName, parseTree, parseTreeLine, spanOf, type TreeNode, utf16Offsets } from "../src/run/tree";

// output/final.tree from running samples/hello-studio on NLPPlus 2.2.37.
const HELLO = "hello world. Hi there, and hey everyone!\n";
const HELLO_TREE = `
FINAL OUTPUT TREE:

_ROOT [0,40,0,40,0,0,node,un]
   _greeting [0,10,0,10,3,13,node,fired,blt]
      hello [0,4,0,4,0,0,alpha]
      \\_ [5,5,5,5,0,0,white]
      world [6,10,6,10,0,0,alpha]
   . [11,11,11,11,0,0,punct]
   \\_ [12,12,12,12,0,0,white]
   _greeting [13,20,13,20,3,13,node,fired,blt]
      Hi [13,14,13,14,0,0,alpha]
      \\_ [15,15,15,15,0,0,white]
      there [16,20,16,20,0,0,alpha]
   , [21,21,21,21,0,0,punct]
   \\_ [22,22,22,22,0,0,white]
   and [23,25,23,25,0,0,alpha]
   \\_ [26,26,26,26,0,0,white]
   _greeting [27,38,27,38,3,13,node,fired,blt]
      hey [27,29,27,29,0,0,alpha]
      \\_ [30,30,30,30,0,0,white]
      everyone [31,38,31,38,0,0,alpha]
   ! [39,39,39,39,0,0,punct]
   \\n [40,40,40,40,0,0,white]
`;

// The same analyzer on text with two-byte letters and an emoji: bytes, code points
// and UTF-16 units all disagree.
const WIDE = "héllo wörld. hi 😀 there";
const WIDE_TREE = `
_ROOT [0,27,0,22,0,0,node,un]
   héllo [0,5,0,4,0,0,alpha]
   \\_ [6,6,5,5,0,0,white]
   wörld [7,12,6,10,0,0,alpha]
   . [13,13,11,11,0,0,punct]
   \\_ [14,14,12,12,0,0,white]
   hi [15,16,13,14,0,0,alpha]
   \\_ [17,17,15,15,0,0,white]
   😀 [18,21,16,16,0,0,emoji]
   \\_ [22,22,17,17,0,0,white]
   there [23,27,18,22,0,0,alpha]
`;

const textOf = (node: TreeNode, text: string) => {
	const span = spanOf(node, utf16Offsets(text));
	return span && text.slice(span[0], span[1]);
};

describe("parseTree", () => {
	const root = parseTree(HELLO_TREE)!;

	it("rebuilds the tree from indentation", () => {
		expect(root.name).toBe("_ROOT");
		expect(root.children.map((n) => n.name)).toEqual(
			["_greeting", ".", "\\_", "_greeting", ",", "\\_", "and", "\\_", "_greeting", "!", "\\n"]);
		expect(root.children[0].children.map((n) => n.name)).toEqual(["hello", "\\_", "world"]);
	});

	it("knows which pass and rule line built a node", () => {
		const greetings = root.children.filter((n) => n.name === "_greeting");
		expect(greetings.map((n) => [n.pass, n.line, n.fired, n.built])).toEqual([
			[3, 13, true, true], [3, 13, true, true], [3, 13, true, true],
		]);
		expect(root.children[0].children[0]).toMatchObject({ pass: 0, line: 0, type: "alpha", built: false });
	});

	it("reads flags by name: an unsealed node is not a fired one", () => {
		expect(root).toMatchObject({ fired: false, built: false });
	});

	it("gives each node the text it covers", () => {
		const greetings = root.children.filter((n) => n.name === "_greeting");
		expect(greetings.map((n) => textOf(n, HELLO))).toEqual(["hello world", "Hi there", "hey everyone"]);
		expect(textOf(root, HELLO)).toBe(HELLO);
	});

	it("maps code points to UTF-16 for letters and emoji outside ASCII", () => {
		const nodes = parseTree(WIDE_TREE)!.children;
		const byName = (name: string) => nodes.find((n) => n.name === name)!;
		expect(textOf(byName("wörld"), WIDE)).toBe("wörld");
		expect(textOf(byName("😀"), WIDE)).toBe("😀");
		expect(textOf(byName("there"), WIDE)).toBe("there");
	});

	it("does not throw on a dump cut off mid-line", () => {
		const cut = HELLO_TREE.slice(0, HELLO_TREE.indexOf("there") + 8);
		expect(parseTree(cut)?.children.length).toBe(4);
		expect(parseTree("no tree here")).toBeUndefined();
	});
});

describe("parseTreeLine", () => {
	it("keeps a bracket token's name", () => {
		expect(parseTreeLine("   [ [3,3,3,3,0,0,punct]")).toMatchObject({ name: "[", depth: 1, type: "punct" });
	});

	it("ignores banners and short field lists", () => {
		expect(parseTreeLine("FINAL OUTPUT TREE:")).toBeUndefined();
		expect(parseTreeLine("x [1,2,3]")).toBeUndefined();
	});
});

describe("spans", () => {
	it("leaves out a node outside the text", () => {
		const node = parseTreeLine("x [0,0,50,52,0,0,alpha]")!;
		expect(spanOf(node, utf16Offsets("short"))).toBeUndefined();
	});

	it("shows whitespace tokens as visible marks", () => {
		expect(["\\_", "\\n", "\\t", "word"].map(displayName)).toEqual(["␣", "⏎", "⇥", "word"]);
	});
});
