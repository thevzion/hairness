# Managed worktrees

Worktree Controls gives every versioned Hairness delivery an explicit checkout,
owner and writer lease. It composes Git evidence from Sources with Codebase
mounts and Session Intelligence; it does not move Git behavior into the kernel.

```text
DeliveryPlan
  └── RepositoryRef + CheckoutContext (references + digests)
        └── WorktreeHandle
              ├── WorktreeController
              ├── live repository, branch, HEAD and realpath
              ├── one active WorktreeLease
              └── correlated CheckoutReceipts
```

The anchor owns one default sibling pool for its workspace and mounted
codebases:

```text
<anchor>-worktrees/
├── workspace/<type>/<slug>
└── codebases/<codebase-id>/<type>/<slug>
```

`preferences.worktrees.root` may override the whole pool for one machine.
`preferences.worktrees.repositoryRoots.workspace` and
`preferences.worktrees.repositoryRoots["codebase:<id>"]` may override one
logical repository. Priority is exact repository root, global root, then the
anchor sibling. There is no automatic fallback.

The canonical registry remains owner-scoped in the anchor workspace at
`.overlay/extensions-state/hairness/worktree-controls/`; no worktree registry
is stored in `~/.hairness`.

`WorktreeController` is generated once and records the real anchor, overlay and
default pool. Every managed Git lock is exact:

```text
hairness:<controllerId>:<worktreeId>:<planId>
```

Moving the anchor changes those observed realpaths and blocks versioned writes
with `controller-relocation-required` until an exact repair checkpoint.

For a Hairness distribution checkout, Worktree Controls may link `.overlay`
back to the anchor only when the path is ignored and absent. It never replaces
an existing entry. External codebases are mounted through Codebase services and
receive no injected Hairness files.

One `DeliveryPlan` owns one handle and one writer lease. Other sessions may
inspect it, but writing requires the exact live lease and Run grant. Handoff and
takeover are explicit; inactivity makes a lease stale but never silently
transfers authority.

`RepositoryRef` contains no path or credential:

```json
{ "kind": "workspace" }
{ "kind": "codebase", "id": "customer-api", "checkout": "default" }
```

`status` and `doctor` resolve the workspace, every mounted codebase and any
repository retained by a handle. Entries are classified as `anchor`, `managed`,
`managed-external`, `foreign-managed`, `unmanaged`, `prunable`, `orphaned` or
`blocked`. Adoption preserves an existing location. Foreign takeover requires
a reason, exact controller-unavailable proof and a break-glass checkpoint.

```bash
hairness worktree
hairness worktree status
hairness worktree doctor
hairness worktree show <id>
hairness worktree open|adopt|sync|handoff|takeover|close|repair|reconcile|prune
hairness worktree close --all-ready
```

Mutating actions first return a deterministic `CheckoutProposal`. Execution
revalidates its digest, current Git evidence, policy, target and writer lease,
then returns a `CheckoutReceipt`. Partial or unknown effects block retry until
live reconciliation. Cleanup refuses dirty, unpushed, unintegrated, missing-lock
or stale evidence and never uses forced removal automatically.
After fresh squash-merge proof, local branch deletion may use `git branch -D`
only when the published HEAD, merged PR and `verify-main` receipt agree. Batch
cleanup validates every child first and records one receipt per worktree.

Git guards installed from the overlay reject commits in the anchor or an
unmanaged checkout and reject direct pushes to `main`. An existing
`core.hooksPath` is never overwritten. These guards complement Hairness
authority and GitHub branch protection; they are not an operating-system
sandbox.

A workspace worktree with a valid controller, handle, lock and writer lease may
inherit the anchor's local trust through its linked overlay. A repository that
merely points at the overlay is not trusted; it must also be the exact managed
Git worktree. Codebase worktrees never receive this distribution link.
