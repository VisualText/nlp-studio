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

export type IconName =
	"dna" | "dna-off" | "dnar" | "dot" | "folder" | "dict" | "kbb" | "file" | "tree" | "json" | "log" | "blank";

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
	// dict.svg: the D of a dictionary.
	dict: `<svg viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M227.75,220.92c0,4.34,8.08,6.51,24.23,6.51,17.46,0,31.2-5.8,41.19-17.42,9.39-11,14.08-25.49,14.08-43.46s-5.1-30.99-15.3-41.8c-10.3-11.21-23.93-16.81-40.89-16.81-15.55,0-23.32,2.07-23.32,6.21,0,5.96-.1,14.92-.3,26.88-.2,11.96-.3,20.92-.3,26.88s.1,14.67,.3,26.43c.2,11.76,.3,20.62,.3,26.58Z"/><path fill="currentColor" d="M439.18,443.82c14.76-1.3,18.31-5.73,18.16-20.33-.64-60.16-1.32-120.32-1.99-180.48-.82-73.39-1.56-146.79-2.56-220.18C452.52,3.61,448.07-.11,428.75,.04c-99.48,.79-198.97,1.53-298.45,2.24-38.93,.28-64.39,22.01-67,61-2.57,38.46-2.28,77.12-3.03,115.7-1.86,95.34-3.68,190.67-5.31,286.02-.46,26.79,15.25,42.7,41.84,43.1,65.82,.98,131.65,1.96,197.48,2.77,43.88,.54,87.77,.79,131.66,1.18,8.97,.08,16.16-3.11,17.03-12.82,.93-10.42-6.07-14.56-15.39-16.03-3.95-.63-7.8-1.93-11.19-2.8-8.76-19.99,7.69-35.23,22.8-36.56ZM169.52,118.17c-.86-23.17-1.29-40.51-1.29-52.02,0-2.12,1.46-3.38,4.39-3.79,7.17-.81,18.93-1.21,35.29-1.21,31.09,0,51.24,.45,60.42,1.36,23.93,2.42,42.65,8.48,56.18,18.17,12.72,9.09,22.77,21.81,30.14,38.16,7.07,15.45,10.6,31.35,10.6,47.7,0,29.68-9.54,55.43-28.62,77.23-16.86,19.49-40.54,29.73-71.02,30.74-5.86,.2-21.96,.3-48.31,.3-4.95,0-12.39-.15-22.34-.45-9.95-.3-17.39-.45-22.34-.45-2.93,0-4.39-1.16-4.39-3.48,0-11.1,.43-27.79,1.29-50.05,.86-22.26,1.29-38.94,1.29-50.05s-.43-29-1.29-52.17Zm213.42,364.29c-96.85-1.31-193.76-2.61-289.76-3.91-5.6-19.8,7.18-36.53,26.59-37.03,24.58-.63,49.19,.08,73.79,.29,59.77,.5,119.54,1.01,179.31,1.64,4.7,.05,9.39,1.09,15.09,1.8-1.8,13.32-3.29,24.39-5.02,37.22Z"/></svg>`,
	// kbb.svg: the speech bubble. Its file stacks the same shape seven times; the topmost
	// fill is the one that shows, so one copy is the whole icon.
	kbb: `<svg viewBox="0 0 487.57 507.95" aria-hidden="true"><path fill="currentColor" d="M486.05,154.02c-14.7-87.03-103.88-131.96-167.27-147.38S184.91,2.11,133.46,44.72c-51.45,42.61-43.27,141.43-43.27,141.43L0,333.9h99.93c.32,0,.61,72.52.61,72.52,0,0-8.52,46.89,12.79,47.14s92.46,3.63,92.46,3.63l2.76,50.77,196.6-.91-.92-174.05s96.52-91.95,81.83-178.98h-.01ZM157.34,245.24c-16.38,0-29.66-13.28-29.66-29.66s13.28-29.66,29.66-29.66,29.66,13.28,29.66,29.66-13.28,29.66-29.66,29.66Z"/></svg>`,
	// file.svg
	file: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M10.57 1.14L13.85 4.44L14 4.8V14.5L13.5 15H2.5L2 14.5V1.5L2.5 1H10.22L10.57 1.14ZM10 5H13L10 2V5ZM3 2V14H13V6H9.5L9 5.5V2H3ZM11 7H5V8H11V7ZM5 9H11V10H5V9ZM11 11H5V12H11V11Z"/></svg>`,
	// tree.svg: the branching parse tree.
	tree: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.3,11.6L1.5,11l6.4-9.5L8.8,2L2.3,11.6z"/><path fill="currentColor" d="M5.4,14.1l-0.8-0.6l2.9-4.2l0.8,0.6L5.4,14.1z"/><path fill="currentColor" d="M7.6,2l0.8-0.6l6.4,9.5L14,11.6L7.6,2z"/><path fill="currentColor" d="M5.1,5.9l0.8-0.6l5.5,8.1L10.6,14L5.1,5.9z"/></svg>`,
	// json.svg: the pair of braces.
	json: `<svg viewBox="0 0 512 512" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"><path d="M188 88 C132 88 132 148 132 200 C132 240 96 256 76 256 C96 256 132 272 132 312 C132 364 132 424 188 424"/><path d="M324 88 C380 88 380 148 380 200 C380 240 416 256 436 256 C416 256 380 272 380 312 C380 364 380 424 324 424"/></g></svg>`,
	// log.svg: the page with a G on it.
	log: `<svg viewBox="0 0 548.291 548.291" aria-hidden="true"><path fill="currentColor" d="M 486.201,196.124 H 473.035 V 132.59 c 0,-0.396 -0.062,-0.795 -0.115,-1.196 -0.021,-2.523 -0.825,-5 -2.552,-6.963 L 364.657,3.677 C 364.624,3.646 364.593,3.635 364.572,3.604 363.942,2.897 363.208,2.312 362.429,1.809 362.2,1.652 361.968,1.523 361.727,1.388 361.055,1.022 360.34,0.717 359.606,0.496 359.406,0.441 359.227,0.36 359.029,0.308 358.23,0.118 357.401,0 356.562,0 H 96.757 C 84.894,0 75.256,9.651 75.256,21.502 V 196.115 H 62.092 c -16.971,0 -30.732,13.756 -30.732,30.733 V 386.66 c 0,16.968 13.761,30.731 30.732,30.731 H 75.256 V 526.79 c 0,11.854 9.638,21.501 21.501,21.501 h 354.776 c 11.853,0 21.501,-9.647 21.501,-21.501 V 417.392 H 486.2 c 16.966,0 30.729,-13.764 30.729,-30.731 V 226.854 c 10e-4,-16.982 -13.762,-30.73 -30.728,-30.73 z M 96.757,21.502 h 249.054 v 110.009 c 0,5.939 4.817,10.75 10.751,10.75 h 94.972 v 53.861 H 96.757 Z m 221.059,281.925 c 0,47.77 -28.973,76.746 -71.558,76.746 -43.234,0 -68.531,-32.641 -68.531,-74.152 0,-43.679 27.887,-76.319 70.906,-76.319 44.756,0 69.183,33.511 69.183,73.725 z M 82.153,377.79 V 232.085 h 33.073 v 118.039 h 57.944 v 27.66 H 82.153 Z M 451.534,520.962 H 96.757 v -103.57 h 354.776 v 103.57 z m 9.642,-149.87 c -10.162,3.454 -29.402,8.209 -48.641,8.209 -26.589,0 -45.833,-6.698 -59.24,-19.664 -13.396,-12.535 -20.75,-31.568 -20.529,-52.967 0.214,-48.436 35.448,-76.108 83.229,-76.108 18.814,0 33.292,3.688 40.431,7.139 l -6.92,26.37 c -7.999,-3.457 -17.942,-6.268 -33.942,-6.268 -27.449,0 -48.209,15.567 -48.209,47.134 0,30.049 18.807,47.771 45.831,47.771 7.564,0 13.623,-0.852 16.21,-2.152 v -30.488 h -22.478 v -25.723 h 54.258 z"/><path fill="currentColor" d="m 212.533,305.37 c 0,28.535 13.407,48.64 35.452,48.64 22.268,0 35.021,-21.186 35.021,-49.5 0,-26.153 -12.539,-48.655 -35.237,-48.655 -22.265,-10e-4 -35.236,21.192 -35.236,49.515 z"/></svg>`,
};

// Which icon a knowledge-base or input file gets, as the extension's kbView and textView do
// (visualText.fileIconFromExt).
export function fileIcon(path: string): IconName {
	if (/\.dict$/i.test(path)) return "dict";
	if (/\.kbb$/i.test(path)) return "kbb";
	if (/\.json$/i.test(path)) return "json";
	if (/\.log$/i.test(path)) return "log";
	if (/\.tree$/i.test(path)) return "tree";
	return "file";
}

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
