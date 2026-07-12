---
name: hairness-roadmap
description: Inspect and steer the forge initiative roadmap.
---

Invoke with `/hairness-roadmap`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/initiative:inspect --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Use the local initiative state, not a transcript. Keep one active initiative, expose its outcome and gate, and distinguish local trajectory from an explicitly reviewed `STATUS.md` snapshot. Never edit Git or a versioned file directly.

No authority is implied. Keep checkpoints and worker capsules exact.
