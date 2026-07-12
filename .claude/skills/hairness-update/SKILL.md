---
name: hairness-update
description: Inspect and safely update source-owned Hairness materials.
---

Invoke with `/hairness-update`.

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/distribution-lifecycle:inspect --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

# Hairness distribution lifecycle

Inspect the tracked lock before proposing an update. Never infer that consumer divergence is safe. `check` may consult the configured source only when the user invokes it; session opening and wake-up stay offline.

An apply requires the exact checkpoint emitted by the immutable plan. Hairness does not create commits, branches, remotes, pull requests, tags, releases, or publishes.

No authority is implied. Keep checkpoints and worker capsules exact.
