# Hairness 0.4 specification

Status: alpha

Public npm package: `@hairness/cli`

The terms MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are normative.

## 1. Boundary

Hairness is a local arranger and build Kernel for source-owned agentic assets.
It MUST NOT own the provider runtime, model, session, product source, credential
or user interface. A Home owns its installed assets and explicit memory. A
Target remains an independent Git repository.

## 2. Home

`hairness.json` MUST validate against `https://hairness.dev/schema.json` and
declare an exact `@hairness/cli` runtime, active providers, registry mappings,
Targets, Integrations and config. Unknown fields MUST fail.

A Home MUST NOT require `package.json`, `package-lock.json`, `node_modules` or
`hairness.lock.json`. `.hairness/build.json` MUST be ignored build state. Git is
the canonical history and restoration mechanism.

Every Home command MUST verify that the executing CLI matches the exact runtime.
Provider hooks MUST invoke that version through `npx --yes`.

## 3. Registry and addresses

A registry MUST validate against
`https://hairness.dev/schema/registry.json`. An item MUST declare its name,
version, type, title, description, dependencies and files. Declared source and
destination paths MUST be relative, remain inside their roots and contain no
symbolic link.

The CLI MUST accept:

- `@namespace/item` through a Home registry mapping;
- `owner/repository/item` with an optional Git tag or commit;
- HTTPS item or registry JSON;
- a local JSON path.

Registry header values MAY reference environment variables. Expanded values
MUST NOT appear in errors, receipts, logs or generated files. HTTP is forbidden.

## 4. Installed item and provenance

An item MUST be copied under `extensions/<namespace>/<item>/`. Its tracked
`hairness.item.json` MUST validate against
`https://hairness.dev/schema/item.json` and record source, requested ref,
resolved commit when available, mobility, dependencies and the initial digest
of each declared file. The receipt MUST NOT include itself in those digests.

No global resolution ledger, version solver, store or lifecycle script exists.

## 5. Add and remove

`add` MUST resolve the full dependency graph, reject cycles and destination
collisions, display planned writes, require confirmation unless `-y`, and apply
all source writes transactionally. It MUST execute no source code.

`remove` MUST refuse an item required by another installed item. It MUST refuse
customized, missing or invalid declared files unless overwrite is explicit. It
MUST remove only declared files and the receipt; unknown local files survive.

## 6. Status, diff and sync

`status` MUST remain offline and classify each declared file as `clean`,
`customized`, `missing` or `invalid` against its base digest.

`sync` MUST fetch the recorded source or `--to` address and MUST execute no code.
`--check` MUST write nothing. If all old declared files are clean, sync applies
the new source atomically. A local change or deletion MUST block all writes
unless `--overwrite` is explicit. Unknown local files always survive. A file
removed upstream is deleted only when its local copy was intact. New
dependencies are installed; old ones require explicit removal.

Hairness performs no automatic merge and no automatic update.

## 7. Build

`build` MUST discover installed receipts, validate declared assets, compose
instructions and Skills and produce native provider projections. It MUST reject
duplicate output owners, unmanaged collisions and divergence from recorded
generated output digests. `build --check` MUST write nothing.

Generated owners and digests MUST be recorded in ignored
`.hairness/build.json`. Unmanaged provider files MUST survive.

## 8. Adapters

An Adapter is an executable file declared by an installed item. `add` and `sync`
MUST NOT run it. Only `build --allow-adapter <id>` may execute it.

The Kernel MUST give an Adapter a staging output root, bounded environment,
time and output size. It MUST reject symbolic links, undeclared output paths,
owner collisions and partial promotion. Approval grants trusted executable
source local process access; the process boundary supplies no OS sandbox.

## 9. Creation

`create` MUST work in a sibling temporary directory, initialize Git, install the
base item or `@hairness/core`, build, doctor, create one initial commit, configure
no remote and atomically rename the qualified Home. Failure MUST leave the final
destination absent.

A `hairness:home` item MAY seed providers, Targets, Integrations and config. It
uses the same registry and provenance model as any Extension.

## 10. Targets, Integrations, Overlay and prologue

A Target binding MUST be an ignored local symlink whose Git remote matches the
declared repository. Discovery MUST be read-only and avoid symlink traversal.

An Integration selects a declared CLI or provider accessor. Hairness MUST NOT
install or authenticate it and MUST NOT persist credentials.

`.overlay/` contains explicit human-owned preferences and memory. Hairness MUST
NOT persist transcripts or hidden reasoning. The prologue contains bounded
preferences, observed facts and repair signals, never registry secrets.

## 11. Release

Only `@hairness/cli@0.4.0-alpha.0` is published, under `next`. A resumed release
MUST compare an existing npm version with the qualified integrity and skip an
identical artifact. An integrity mismatch MUST stop.

npm publication, Git tag, GitHub prerelease, downstream Home merges and external
communication remain separate approved effects.
