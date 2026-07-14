# Managed worktrees

Worktree Controls gives every versioned Hairness delivery an explicit checkout,
owner and writer lease. It composes Git evidence from Sources with Codebase
mounts and Session Intelligence; it does not move Git behavior into the kernel.

```text
DeliveryPlan
  └── CheckoutContext (reference + digest)
        └── WorktreeHandle
              ├── exact repository, branch, HEAD and realpath
              ├── one active WorktreeLease
              └── correlated CheckoutReceipts
```

The default placement is a sibling tree:

```text
<parent>/<repository>-worktrees/<type>/<slug>
```

`preferences.worktrees.root` may override that location for one machine. The
canonical registry remains owner-scoped in the anchor workspace at
`.overlay/extensions-state/hairness/worktree-controls/`; no worktree registry
is stored in `~/.hairness`.

For a Hairness distribution checkout, Worktree Controls may link `.overlay`
back to the anchor only when the path is ignored and absent. It never replaces
an existing entry. External codebases are mounted through Codebase services and
receive no injected Hairness files.

One `DeliveryPlan` owns one handle and one writer lease. Other sessions may
inspect it, but writing requires the exact live lease and Run grant. Handoff and
takeover are explicit; inactivity makes a lease stale but never silently
transfers authority.

```bash
hairness worktree
hairness worktree status
hairness worktree doctor
hairness worktree show <id>
hairness worktree open|adopt|sync|handoff|takeover|close|repair|reconcile|prune
```

Mutating actions first return a deterministic `CheckoutProposal`. Execution
revalidates its digest, current Git evidence, policy, target and writer lease,
then returns a `CheckoutReceipt`. Partial or unknown effects block retry until
live reconciliation. Cleanup refuses dirty, unpushed, unintegrated, missing-lock
or stale evidence and never uses forced removal automatically.

Git guards installed from the overlay reject commits in the anchor or an
unmanaged checkout and reject direct pushes to `main`. An existing
`core.hooksPath` is never overwritten. These guards complement Hairness
authority and GitHub branch protection; they are not an operating-system
sandbox.
