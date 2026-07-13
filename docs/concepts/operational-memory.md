# Operational memory

Hairness preserves routed intent, not conversation.

The append-only Semantic Ledger records Invocation origin, WorkRef, operation,
events, typed result digest, proof, limits and receipt. The Work Graph records
mission, segment and frame. RouteRuns record bounded worker execution. The
Artifact Graph records promoted meaning. None of these stores transcripts or
hidden reasoning.

`AttentionIndex` is a derived projection, never a second work store. Active
segments and frames, open Invocations and Runs, authority/input/budget/split
needs, stale proof, recent results, extension contributions, and `openEdges`
from closed SegmentDigests become recoverable topics. Items deduplicate by
WorkRef/continuation and sort deterministically: blockers first, then required
human input, active work, open Runs, stale proof, open edges and recent results.

SessionOpening receives only the top three signals. `wake-up` renders immediate
attention, `hairness-cmd-show-topics` exposes at most twenty subjects, and
`hairness-cmd-show-trace` renders Invocation -> Runs -> result -> fan-in for the
active work.

Resuming closed work is two-step: inspect it read-only, then explicitly open a
new segment with `continues`. Only one segment is active. Other subjects remain
discoverable without competing for current focus.

The guarantee covers Hairness commands, routed methodology bindings and their
Runs. Free conversation, direct third-party skills, and provider tool calls are
outside scope.
