---
name: hairness-handoff
description: Produce a compact durable handoff without storing a transcript.
---

Invoke with `$hairness-handoff`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/session:handoff --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Create a compact session digest from explicit input. Confirm that volatile transcript input is opted in before reading it.

No authority is implied. Keep checkpoints and worker capsules exact.
