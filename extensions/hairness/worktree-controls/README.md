# Worktree Controls

## Value and use cases

Worktree Controls makes parallel Git delivery explicit. Each delivery plan owns
one registered checkout and at most one writer lease; other sessions may inspect
it but cannot mutate through Hairness.

## Selection and setup

Select `hairness/worktree-controls` with its required dependencies:
`hairness/codebase`, `hairness/sources` and `hairness/session-intelligence`.
Distributions configure `defaults.worktrees`:

```json
{
  "placement": "sibling",
  "directorySuffix": "-worktrees",
  "layout": "{type}/{slug}",
  "enforcement": "required",
  "hooks": "required",
  "cleanup": "checkpoint"
}
```

`preferences.worktrees.root` may override the physical root locally. With the
default policy, `<parent>/<repository>-worktrees/<type>/<slug>` is used.

## Capabilities and operations

`hairness worktree` shows the inventory. The namespace also provides `status`,
`show`, `doctor`, `open`, `adopt`, `sync`, `handoff`, `takeover`, `close`,
`repair`, `reconcile` and `prune`.

Dependent extensions use the read-only `inspect`, `propose` and `resolve`
services, the authority-bound `execute` service, and `assert-writer` before
their own Git-backed effects. Delivery stores only a handle reference and its
digest; path, branch, HEAD, policy and lease are resolved live.

## Inputs, controls and results

Operations accept a typed `CheckoutRequest`, preview an idempotent
`CheckoutProposal`, and return a `CheckoutReceipt` correlated to its Run,
checkpoint, policy and live `CheckoutContext`. `--auto` never grants authority.

## State and artifacts

The canonical registry is owner-scoped under
`.overlay/extensions-state/hairness/worktree-controls/`. It contains handles,
leases, proposals and receipts, never credentials or provider conversations.

## Effects and safety

Creation uses locked Git worktrees. Workspace checkouts may link `.overlay` to
the anchor only when that path is ignored and absent. External codebases are
mounted through Codebase services without adding files to their repository.
Guards live under the anchor overlay and may be installed only when no existing
`core.hooksPath` would be overwritten.

No command force-removes a checkout. Dirty, unpushed, unintegrated, stale,
partial or unknown states block cleanup or retry until fresh reconciliation.
Git locks protect worktree metadata; writer leases are the Hairness authority
contract and not an operating-system sandbox.

## Providers

Projects `$hairness-worktree` for Codex and `/hairness-worktree` for Claude.
Both providers use the same deterministic namespace and owner-scoped state.

## Tests and maturity

Owner tests cover placement, idempotence, writer collisions, handoff/takeover,
live invalidation, overlay safety, cleanup refusal and recovery. The extension
is experimental in `0.2.0-alpha.0`.
