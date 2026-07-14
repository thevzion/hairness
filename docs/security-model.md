# Security model

Hairness separates access from authority. Mounts, adapters, providers, and
extensions grant no mutation rights. An executor receives effects only after a
stored checkpoint is matched to its Run, Assignment, current policy and locks,
then returns a validated receipt.

The WorkerResultGate validates the complete typed result and current run state
before staging or promoting any producer artifact. A rejected result leaves the
run resumable and cannot advance the durable artifact revision.

Hairness stores no credentials, auth artifacts, customer data, provider
transcripts, or model reasoning. Workspace-local state lives in `.overlay/`;
user trust and preferences live in `~/.hairness/`.

Local codebase mounts and extension links are path references, not authority.
Remote GitHub/npm targets use normalized URI identities without credentials,
queries or fragments. Hairness validates canonical paths and declared
identities before recording them. Unmount and unlink operations remove only
Hairness-owned symlinks and configuration, never their targets.

For versioned mutations, Worktree Controls adds another policy layer: the
canonical target must resolve to a managed handle owned by the plan and the
calling Run must hold its exact active writer lease. The anchor workspace,
unmanaged checkouts and stale leases are denied. Codebase managed-mount
services call `authority.assert(runId, effect, target)` themselves rather than
trusting their caller.

Overlay-owned `pre-commit` and `pre-push` guards reject unmanaged commits and
direct pushes to `main`. Hairness never replaces an existing `core.hooksPath`;
that state requires explicit integration. Hooks, leases and branch protection
are defense in depth, not an OS-level filesystem sandbox.
