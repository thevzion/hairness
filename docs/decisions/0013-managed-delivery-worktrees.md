---
id: 0013-managed-delivery-worktrees
status: accepted
owners: [hairness/worktree-controls, hairness/delivery-controls]
signals: [worktree, delivery, authority, parallelism]
paths: [extensions/hairness/worktree-controls, extensions/hairness/delivery-controls]
---

# Managed worktrees for versioned delivery

Every Hairness-controlled versioned mutation targets an explicit managed Git
worktree with one plan owner and one writer lease. The stable Hairness checkout
remains the anchor for owner-scoped registry state and main-session fan-in.

Worktree Controls owns checkout lifecycle and recovery. Delivery Controls owns
when a change or release needs a checkout and stores only a revalidated context
reference. Sources owns Git evidence, Codebase owns mounts, Session Intelligence
owns session identity and the kernel remains limited to targets, locks, grants
and receipts.

The Hairness distribution anchor owns one controller and one default sibling
pool. Workspace worktrees live under `<anchor>-worktrees/workspace/`; mounted
codebase worktrees live under
`<anchor>-worktrees/codebases/<codebase-id>/`. `RepositoryRef` stays logical;
paths, remotes and Git common directories are resolved from live Sources and
Codebase evidence.

The controller identity, handle, exact Git lock, writer lease and correlated
receipt jointly prove ownership. Physical placement is organization, not
authority. Existing worktrees may be adopted in place, a foreign controller
requires an explicit proof-backed takeover, and moving an anchor blocks until
a repair checkpoint. Cleanup, handoff, takeover, adoption and repair remain
explicit; no inactivity, merge or successful delivery silently deletes or
transfers a checkout.
