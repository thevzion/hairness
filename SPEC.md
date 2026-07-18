# Hairness 0.4 specification

Status: experimental alpha · package `@hairness/cli@0.4.0-alpha.0`

## Boundary

Hairness is a lightweight Kernel for agent workspaces. A Home owns agentic
assets; a Target remains an independent Git repository. Providers own models,
threads, tools and UI. Hairness owns no provider runtime or repository
checkout lifecycle.

## Documents

Every public JSON document has `apiVersion` and `kind`:

| Document | API |
| --- | --- |
| Home | `hairness.dev/home/v1alpha2` |
| HomeLock | `hairness.dev/home-lock/v1alpha2` |
| Extension | `hairness.dev/extension/v1alpha2` |
| Prologue | `hairness.dev/prologue/v1alpha1` |

There is no global protocol or schema version. Packages and extensions use
SemVer.

## Home

`hairness.json` contains only providers, active extension IDs, Git Target
identities, Integration declarations and namespaced extension config. It never
contains local paths, runtime state, provider output or secrets.

`hairness.lock.json` pins the Kernel source/integrity and installed extension
source, commit and digest. `.overlay/config.json` is local human configuration:
optional `name`, `addressAs`, `responseLanguage`, `note`, plus Integration
bindings by provider. `.hairness/` and `targets/` are ignored machine state.

## Extensions

An explicit `extension.json` may declare `instructions`, `skills`, `commands`, a
single read-only `prologue` contributor, `checks`, `configSchema` and direct
dependencies. Sources use `skill.md`; provider compilers generate native
`SKILL.md`. Commands expose Skills and do not duplicate their source.

Manifest inspection never executes code. Paths must stay inside the extension,
symlinks and nested locks are rejected, and only IDs listed in the Home activate.
Git refs resolve to immutable commits. Updates stop when the installed tree was
edited. No generic merge or migration engine exists.

## Targets and Integrations

A Target is identified by normalized Git remote and bound through an ignored
`targets/<id>` symlink to a clone or worktree. Discovery is recursive, read-only,
does not follow directory symlinks, stops at Git repositories, inspects all
remotes and reports unreadable paths as limits. Binding refuses a remote
mismatch and never deletes the checkout.

An Integration declares accessors such as `cli:jira`, `provider:tool` or an
explicit `none` binding. Hairness never installs or authenticates access. Doctor
checks CLI presence and reports provider access as externally supplied.

## Prologue and persistence

`hairness prologue` returns `preferences`, `facts` and `signals` in tagged text;
`--json` returns the same model. Kernel facts cover Home and Targets. At most
one timed, isolated read-only contributor per active extension may add facts or
signals. It cannot emit Markdown, secrets or effects.

Sessions are ephemeral. A Scratch is created explicitly as
`.overlay/scratches/<slug>/scratch.md`; no transcript, session journal, status
machine or active pointer is written. Accepted documents are ordinary files
under `.overlay/artifacts/` when a user chooses to save them.

## Provider build

The compiler projects the three built-in Skills (`hairness`,
`hairness-onboarding`, `hairness-scratch`) plus active extension assets into
Codex and Claude. It preserves unmanaged provider files and tracks only exact
owned outputs in ignored `.hairness/build.json` and `.git/info/exclude`.

## Compatibility

0.4 has no v0.3 reader, alias, migration or in-place Home upgrade. Create a new
Home and copy only human material deliberately.
