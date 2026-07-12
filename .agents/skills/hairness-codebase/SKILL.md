---
name: hairness-codebase
description: Inspect or route work for a registered codebase.
---

Invoke with `$hairness-codebase`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/codebase:inspect --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Resolve the codebase and action, then run the matching `hairness codebase` route. Treat live source evidence as current truth.

No authority is implied. Keep checkpoints and worker capsules exact.
