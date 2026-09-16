// The sequence icons, from the VS Code extension (vscode-nlp/resources, MIT, Amnon Meyers
// and David de Hilster), so a pass looks here as it looks there.
//
// The extension picks one per pass in sequenceView.ts getTreeItem: the DNA helix for a rule
// pass, greyed when the pass is switched off, the helix with a pink head for a recursive
// pass, a folder for a folder, and a dot for anything else (tokenize, dicttokz, a stub).
//
// The artwork ships as a light and a dark file per icon, differing only in colour. Here the
// shapes carry `currentColor` instead, and styles.css gives the colour, so one copy serves
// both themes and the greyed state is the same shape rather than a second drawing.

export type IconName = "dna" | "dna-off" | "dnar" | "dot" | "folder" | "blank";

// dna.svg: the double helix, drawn as two strands.
const HELIX = `<path fill="currentColor" d="M1.3,0c0,1.1,0.4,2.3,1.1,3.1c0.8,0.9,1.8,1.7,2.9,2.4C6.5,6.3,7.8,7.1,9.1,8c0.8,0.6,1.6,1.3,2.2,2.1c0.7,0.9,1.1,2.1,1.2,3.3c0,0.1,0,0.3,0,0.4h-1.2l-0.1-0.9c0-0.3-0.1-0.4-0.4-0.4H2.2l0.5-1c0.1-0.2,0.3-0.3,0.4-0.2h7.5l-0.9-1C9.7,10.1,9.5,10,9.3,10H4.1V9.9c0.5-0.3,1-0.7,1.4-1C5.7,8.8,5.9,8.8,6,8.8h1.7H8c-0.6-0.4-1.1-0.7-1.6-1C6.3,7.7,6.2,7.7,6.1,7.7C5.4,8.1,4.8,8.5,4.2,8.9c-0.8,0.5-1.4,1.2-2,1.9c-0.7,0.8-1,1.9-1,2.9H0c0.1-0.7,0.2-1.3,0.4-2C0.9,10.3,1.8,9.1,3,8.3c0.7-0.5,1.3-1,2-1.4C4.9,6.8,4.8,6.7,4.7,6.7C3.8,6,2.9,5.4,2.1,4.7C0.8,3.5,0,1.8,0,0H1.3z"/><path fill="currentColor" d="M12.5,0c0,1.2-0.4,2.4-1.1,3.4c-0.6,0.8-1.2,1.5-2,2.1C9,5.8,8.6,6.1,8.2,6.4c-0.1,0.1-0.3,0.1-0.4,0C7.5,6.2,7.2,6,6.9,5.8L8,5.1V5C7.4,5,6.8,5,6.3,5c-0.4,0-0.7-0.1-1-0.3C4.9,4.4,4.5,4.1,4.1,3.8V3.7h5.2c0.2,0,0.4-0.1,0.5-0.2c0.3-0.3,0.5-0.6,0.8-1V2.4H3.2C3,2.5,2.8,2.4,2.7,2.2l-0.5-1h8.6c0.3,0,0.4-0.1,0.4-0.4s0-0.6,0.1-0.9L12.5,0z"/>`;
// dnar.svg: the same helix, with the pink head that marks a recursive pass.
const RECURSIVE_HEAD = `<path fill="#ee2867" d="M2.2,0h10.3s-.6,3.1-2.1,4.3-2.7,2.1-2.7,2.1c0,0-3.5-2.5-4.7-4s-.8-2.4-.8-2.4Z"/>`;

const SVG: Record<Exclude<IconName, "blank">, string> = {
	dna: `<svg viewBox="0 0 12.5 13.7" aria-hidden="true">${HELIX}</svg>`,
	"dna-off": `<svg viewBox="0 0 12.5 13.7" aria-hidden="true">${HELIX}</svg>`,
	dnar: `<svg viewBox="0 0 12.5 13.7" aria-hidden="true">${HELIX}${RECURSIVE_HEAD}</svg>`,
	// seq-circle.svg
	dot: `<svg viewBox="0 0 7.4 7.4" aria-hidden="true"><circle fill="currentColor" cx="3.7" cy="3.7" r="3.7"/></svg>`,
	// folder.svg
	folder: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M14.5 2h-7.492l-1 2h-3.504c-.277 0-.5.224-.5.5v8c0 .276.223.5.5.5h11.996c.275 0 .5-.224.5-.5v-10c0-.276-.225-.5-.5-.5zm-.496 2h-6.496l.5-1h5.996v1z"/></svg>`,
};

// Which icon a pass gets, as sequenceView.ts decides it. Python passes fall to the dot:
// the studio does not run them.
export function passIcon(kind: string, active: boolean): IconName {
	if (kind === "folder") return "folder";
	if (kind === "rec") return "dnar";
	if (kind !== "nlp" && kind !== "pat") return "dot";
	return active ? "dna" : "dna-off";
}

export function iconElement(name: IconName): HTMLElement {
	const span = document.createElement("span");
	span.className = `file-icon ${name}`;
	// Static artwork from this module, never anything a person or a repository wrote.
	if (name !== "blank") span.innerHTML = SVG[name];
	return span;
}
