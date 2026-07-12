---
name: hairness-check-sources
description: Resolve proof gaps using selected sources before broader discovery.
---

Invoke with `/hairness-check-sources`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/sources:doctor --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

# Sources

Use selected local drivers to produce current typed evidence. Source reads are explicit, read-only and bounded to declared operations. Evidence proves current truth; durable artifacts only orient.

No authority is implied. Keep checkpoints and worker capsules exact.
