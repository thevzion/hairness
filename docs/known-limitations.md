# Known limitations

- v0.3 is experimental and intentionally incompatible with v0.2.
- Only npm, Node.js 22+, Codex, and Claude are supported.
- Distribution Git sources are not synchronized after bootstrap.
- There is no hosted extension registry or marketplace.
- Overlay sharing, remote sync, and encryption are out of scope.
- Adaptive checkout state is local to one user runtime; Hairness is not a team
  scheduler or worktree controller.
- Hairness prepares exact PR boundaries but does not infer repository hosting,
  remote creation, merge, tag, release, or publication authority.
- Extension divergence requires a human merge; there is no generic migration or
  three-way merge engine.
- Maps are focused live compression, not a permanent whole-codebase index.
