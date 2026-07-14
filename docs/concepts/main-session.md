# Main session

The main session is Hairness's primary user interface. It keeps the human's intention, asks the necessary questions, grants authority, and receives compact results.

Session opening begins with an imperative language instruction covering commentary, questions, and final answers; only an explicit current prompt may override it. The core then aggregates extension-owned fragments for profile, non-secret identities, provider state, selected sources, codebases, Work Controls, runs, and at most three attention signals. Each fragment stays below 512 bytes, the whole opening stays below 4 KiB, and no slow external read is allowed.

`hairness-wake-up` is normally a rendering operation over that fresh opening and uses zero tools. An absent or explicitly refreshed opening requires exactly one `hairness wake-up --json` call.

Deeper context is pulled through CLI routes and reduced into ContextPackets. Workers never inherit this cockpit.

When Delivery reaches `implement`, the main session dispatches the provider's
native worker with only its `WorkerCapsule` and managed checkout realpath. The
main session remains the fan-in owner and reports worktrees that need handoff,
repair, synchronization or cleanup as attention rather than hiding them.
