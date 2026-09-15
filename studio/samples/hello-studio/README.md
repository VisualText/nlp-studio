# hello-studio

The studio's own sample: three NLP++ passes small enough to read at a glance, and
written to exercise the editor's language features across files.

| Pass | What it shows |
|---|---|
| `funcs.nlp` | a user function declared in `@DECL`, and the knowledge base |
| `greeting.nlp` | a rule that calls that function from `@POST` (go to definition crosses files) |
| `output.nlp` | `@CODE` writing `output/output.json` |

Run on `input/hello.txt` it writes `{"greetings": 3}`.

`kb/user/hier.kb` is the engine's base concept hierarchy -- what every analyzer
starts from. Without it, adding any attribute stops the engine. It is copied unchanged
from [nlp-engine](https://github.com/VisualText/nlp-engine) (MIT),
`.github/workflows/tests/call-analyzer/kb/user/hier.kb` at 7437ec6, the same file the
analyzers bundled with NLPPlus ship.
