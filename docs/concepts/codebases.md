# Codebases and local hub

A codebase contract identifies a repository the distribution may inspect or operate on. The contract records expected remotes, requirement policy, relationships and test commands; it does not record a developer's checkout path.

```text
hairness.json.codebases
  shared team contracts

.overlay/config.json.codebases.local[]
  local-only contracts

.overlay/config.json.codebases.mounts.<id>.<checkout>
  machine-specific mount state

.overlay/codebases/<id>/<checkout>
  symlink to one actual checkout

.overlay/artifacts/codebase/<id>/
  generated maps and digests
```

Use a shared contract when every distribution consumer should recognize the repository. Use a local contract when the current Hairness checkout acts as a personal hub for an external or private repository.

```bash
hairness codebase add --local private-docs --path ../private-docs --remote git@example.com:team/private-docs.git
hairness codebase mount app ../app --as default
hairness codebase mount app ../app-fix-123 --as fix-123
hairness codebase private-docs doctor --checkout default
```

Every mount validates its realpath, Git repository and declared remote. A repository without `origin` is mounted as `remote-pending`; a conflicting remote is rejected. Removing a mount deletes only Hairness local state and preserves the checkout.

Plans freeze an exact TargetSet: codebase ID, checkout ID, canonical realpath, branch, HEAD, dirty baseline, and digest. Authority and locks cannot be reused for a different checkout.

Mounts provide addressability and proof. They never grant an executor authority.

Worktree Controls owns the lifecycle of delivery checkouts. For an external
registered codebase it calls Codebase's `mount-managed` and `unmount-managed`
services with the exact calling Run, effect and credential-free checkout target.
Those services assert the Run grant before changing Hairness-owned mount state
and always preserve the actual checkout. The current Hairness workspace needs
no Codebase mount: its managed handle points directly at the verified worktree.
