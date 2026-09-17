// @visualtext/analyzer-views: an NLP++ analyzer's sequence, knowledge base, run results and
// code, shown as the NLP++ extension for VS Code shows them, for any web page.
//
//   import "@visualtext/analyzer-views/style.css";
//   import "@visualtext/analyzer-views";      // defines <nlp-sequence>, <nlp-knowledge-base>,
//                                             <nlp-output>, <nlp-trees>, <nlp-code>, <nlp-log>,
//                                             <nlp-values>
//
// The rules without the elements: "@visualtext/analyzer-views/rules".
import { defineAnalyzerViews } from "./elements.js";

export * from "./rules.js";
export { iconElement } from "./icons.js";
export { MAX_HIGHLIGHT_CHARS, THEMES, nlpHighlighter, nlpTokens } from "./highlight.js";
export {
	type OpenDetail, NlpCode, NlpKnowledgeBase, NlpLog, NlpOutput, NlpSequence, NlpTrees, NlpValues, defineAnalyzerViews,
} from "./elements.js";

defineAnalyzerViews();
