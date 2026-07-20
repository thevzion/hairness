# Hairness 0.4.0-alpha.0

Hairness now treats agentic assets as source you own.

A registry manifest points at Skills, instructions, knowledge or an Adapter.
`hairness add` copies those files into a Home, writes a small provenance receipt
and leaves Git in charge of history. `status`, `diff` and `sync` can compare the
source without a global lock, solver or background updater.

The one published package is the on-demand `@hairness/cli` Kernel. A Home needs
no Hairness dependency, `package.json`, `package-lock.json` or `node_modules`.
The Kernel builds the owned assets into Codex and Claude projections while
Targets remain independent repositories and `.overlay/` remains explicit human
memory.

Executable Adapters are inert during add and sync. A named
`build --allow-adapter` approval runs them in staging with declared output,
symlink, ownership and digest checks. The GSD proof invokes exactly
`@opengsd/gsd-core@1.6.1` through its official installer.

The alpha is qualified on Node.js 22 and 24, two real personal Homes and a fresh
empty-directory bootstrap. It has no in-place migration from earlier models.
