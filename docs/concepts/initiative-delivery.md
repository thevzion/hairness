# Initiative and delivery controls

The forge separates strategic trajectory from operational delivery.

```text
Initiative
  outcome + gate + evidence + links
        │
        ▼
DeliveryBrief → ChangeDeliveryPlan
  prepare → implement → qualify → publish PR → CI → merge → verify main
        │
        ▼ accepted merged plans
ReleaseDeliveryPlan
  collect → release PR → CI → merge → verify main → qualify tarball → npm
  → create Git tag → push Git tag → GitHub Release
        │
        ▼
operation checkpoints + typed receipts
```

Initiative Controls keeps the local macro roadmap in owner-scoped overlay state. `STATUS.md` is a deliberately published snapshot, never the live database. Publishing returns a filesystem checkpoint and executor input; the handler does not edit the file.

Delivery Controls implements a generic, distribution-configured GitHub Flow.
An initiative may contain several parallel `ChangeDeliveryPlan` objects; each
accepted brief produces one idempotent plan for one coherent pull request.
`ReleaseDeliveryPlan` separately aggregates conventional merged pull requests
since the previous tag. Release commits and changes explicitly carrying
`releaseImpact: none` are excluded. The explicit version is checked against the
configured package manifest and accompanied by a SemVer recommendation.

Every effect boundary stores its policy digest, exact targets, Run, checkpoint
and expected proof before the executor starts. `PullRequestProposal` binds the
PR title and body to the inspected files, head and diff digest. Missing, stale,
partial or unknown proof blocks progression. A `ReleaseCandidate` binds the
package, version, tag, commit, checks, changes, tarball path, SHA-256, npm
integrity, dry-run and limitations.

A partial, failed or unknown receipt remains immutable. Progress resumes only
through a separately checkpointed reconciliation decision: `accept-deviation`,
`retry` or `abort`. The decision binds the exact receipt, current policy and
fresh observed proof. `--auto` may prepare this checkpoint but never apply it;
accepting a deviation resolves only that receipt and does not weaken policy for
future effects.

The handler prepares checkpoints and records proof, but never stages, commits,
pushes, opens a PR, merges, tags, releases, publishes npm, or posts externally.
Those are separate provider-native executor Runs; npm, local Git tag creation,
remote tag push and GitHub Release can never share implicit authority.

Stage order survives the transition from a qualified pre-commit diff to its
resulting pull-request head. Merge authority is granted only when the
pull-request receipt and fresh CI receipt both match the exact requested head;
the later head does not retroactively invalidate the earlier qualification.

This boundary lets Hairness improve itself without becoming a Git bot: the native agent performs an approved operation and returns a receipt; the extension preserves the plan and evidence.
