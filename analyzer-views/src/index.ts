// @visualtext/analyzer-views: an NLP++ analyzer's sequence, knowledge base and run results,
// listed as the NLP++ extension for VS Code lists them, for any web page.
//
//   import "@visualtext/analyzer-views/style.css";
//   import "@visualtext/analyzer-views";      // defines <nlp-sequence>, <nlp-knowledge-base>,
//                                             <nlp-output> and <nlp-trees>
//
// The rules without the elements: "@visualtext/analyzer-views/rules".
import { defineAnalyzerViews } from "./elements.js";

export * from "./rules.js";
export { iconElement } from "./icons.js";
export {
	type OpenDetail, NlpKnowledgeBase, NlpOutput, NlpSequence, NlpTrees, defineAnalyzerViews,
} from "./elements.js";

defineAnalyzerViews();
