---
name: hairness-session
description: Inspect or reconcile the current provider session association.
---

Invoke with `$hairness-session`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/session:inspect --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Run the requested session route. Preserve provider associations and digests, never transcripts or reasoning.

No authority is implied. Keep checkpoints and worker capsules exact.
