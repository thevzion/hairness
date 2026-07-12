---
name: hairness-constraint
description: Inspect or change inherited session, segment and frame constraints.
---

Invoke with `$hairness-constraint`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/constraints:inspect --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Constraints inherit from session to segment, frame and operation. A child may only tighten its boundary. Clearing is explicit at the owning scope. Constraints never grant authority; every effect still requires an operation-scoped checkpoint and worker capsule.

No authority is implied. Keep checkpoints and worker capsules exact.
