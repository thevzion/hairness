---
id: 0005-repo-provider-projections
status: accepted
owners: [hairness/cockpit]
signals: [provider, projection, portability]
paths: [.agents, .codex, .claude, src/providers/compiler.mjs]
---

# 0005: Repo-local provider projections

Hairness compiles active commands, guidance, hooks, and workers into native repo-scoped Codex and Claude files.

Protocol 0.2 has no plugin, marketplace, global registration, attachment, or absolute symlink. A fresh clone already contains the shared provider surface.
