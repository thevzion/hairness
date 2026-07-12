---
name: hairness-onboarding
description: Continue deterministic local onboarding one question at a time.
---

Invoke with `$hairness-onboarding`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/cockpit:onboarding --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

Run `hairness onboarding next --json`. Ask exactly the returned question; never skip the checkpoint or infer trust.

No authority is implied. Keep checkpoints and worker capsules exact.
