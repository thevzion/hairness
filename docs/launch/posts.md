# Launch copy

Checkpoint 3 controls publication of these drafts.

## Canonical statement

Hairness copies agentic assets from a registry into a Git-owned Home. You can
read, edit and commit the source, then build the same assets for Codex or Claude.
A small provenance receipt supports status, diff and cautious sync.

## GitHub prerelease

### Hairness 0.4.0-alpha.0: source-owned agentic assets

Hairness 0.4 rebuilds the project around file ownership.

A registry manifest points to Skills, instructions, knowledge and approved
Adapters. `hairness add` copies them into your Home. Git records the result.
Each Extension keeps a receipt with its source, resolved Git commit and original
file digests, so `status`, `diff` and `sync` can detect local edits.

The Home has no Hairness npm dependency or lockfile. It declares one exact
on-demand runtime, which builds native Codex and Claude projections. Executable
Adapters remain inert until a named `build --allow-adapter` approval.

```bash
npx --yes @hairness/cli@0.4.0-alpha.0 create "$HOME/my-home"
```

This alpha has no in-place migration from previous models.

## LinkedIn

My colleagues wanted shared agent context, explicit memory and enough
flexibility to adapt the result to each team. I had the same needs in two Homes
I use for agentic tools and game development.

Hairness 0.4 packages that pattern into a small source arranger. A team publishes
a JSON registry from GitHub or an internal endpoint. Each collaborator copies
the chosen Skills, instructions and knowledge into a Home, reviews the source
and commits it. Hairness records provenance per Extension and stops sync when it
finds a local change.

The Home stays stable across Codex and Claude. Product repositories stay outside
it as Targets. `.overlay/` holds explicit human memory. Approved Adapters cover
the cases that need code generation; the GSD proof installs Core 1.6.1 through
its official installer in staging.

The candidate runs on Node 22 and 24 and powers two existing Homes. One npm
package remains: the on-demand CLI.

## X

Hairness 0.4 copies agentic assets from GitHub, HTTPS or a local registry into a
Git-owned Home, then builds them for Codex and Claude. Editable source,
per-Extension provenance, cautious sync, approved Adapters. One CLI package.

## Show HN

### Show HN: Hairness, source-owned agentic assets for Codex and Claude

I built Hairness for teams that want to share agent context without hiding it in
a runtime or package dependency.

A registry contains JSON and source files. `hairness add` copies an item under
`extensions/` and writes a receipt with its source and original digests. You own
the files and can edit them. `hairness sync` updates an intact item and stops on
local divergence. Git handles history and rollback.

`hairness build` projects those assets to Codex and Claude. A Home can bind
independent product repositories as Targets and keep explicit memory under
`.overlay/`. An Adapter can generate deeper provider assets after named consent;
ordinary installation never executes it.

I would value feedback on the receipt model and the boundary between source
sync and Git.

## Reddit

### Hairness 0.4 alpha: source-owned agentic assets with cautious sync

I use separate agent Homes for agentic-tool work and game development. Colleagues
also asked for shared context and memory that could work across providers.

Hairness now uses a shadcn-style source model. A JSON registry describes Skills,
instructions, knowledge or an Adapter. The CLI copies the files into the Home,
where you review and commit them. A per-Extension receipt records the original
digests. Status stays offline; sync stops if you changed or removed a declared
file. Unknown local files survive.

The CLI can project one Home to Codex and Claude. Product repositories remain
independent Targets. Adapter code runs only after explicit build approval and
Hairness checks staged output paths, symbolic links, owners and digests.

I am looking for criticism of this source ownership and sync model before adding
more registry infrastructure.
