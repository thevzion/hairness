# Launch copy

These drafts are not approved for publication until checkpoint 3.

## Canonical statement

Hairness 0.4 alpha is a small, provider-neutral kernel for composable agent
Homes. Starters, Extensions and optional Catalogs are ordinary exact packages;
npm owns the lock, Hairness owns the build, and product repositories remain
independent Targets.

## GitHub prerelease

### Title

Hairness 0.4.0-alpha.0: package-native agent Homes

### Body

Hairness 0.4 is a clean reconstruction.

An agent Home is now an npm project that pins a Starter and Extensions, selects
them in `hairness.json`, and builds native Codex and Claude assets. There is one
dependency lock, exact npm and Git sources, optional Catalogs, transactional
updates, and controlled Adapter output ownership.

The release ships `@hairness/native`, `@hairness/starter`, then
`@hairness/cli` under the `next` tag.

Start with:

```bash
npx --yes @hairness/cli@0.4.0-alpha.0 create "$HOME/Hairness"
```

This is an alpha with no in-place migration from 0.3.

## LinkedIn

I rebuilt Hairness from the concrete cases that already worked: personal agent
Homes, team-owned skills, independent product repositories, and one real Adapter
for an existing workflow system.

Hairness 0.4 alpha treats an agent Home as an npm project. Starters, Extensions
and Catalogs are versioned packages. npm owns `package-lock.json`;
`hairness.json` owns the composition; Hairness builds native Codex and Claude
assets and tracks every generated file by owner and digest.

The Kernel stayed small. Domain depth lives in Extensions. Product repositories
remain independent Targets.

The release candidate is qualified on Node 22 and 24, two real Homes, and a
private team Starter with a GSD Adapter pinned to GSD Core 1.6.1.

## X

Hairness 0.4 alpha rebuilds agent Homes as exact npm package compositions:
Starter + Extensions + optional Catalogs, one package lock, native Codex/Claude
assets, controlled Adapters, independent Targets. Small Kernel, depth in
Extensions.

## Show HN

### Title

Show HN: Hairness, package-native agent Homes for Codex and Claude

### Body

Hairness is a local kernel that composes versioned agent assets into native
Codex and Claude files.

Version 0.4 is a clean reset around npm packages. A Home pins a Starter and
Extensions in `package.json`, uses `package-lock.json` as its only dependency
lock, and selects the active composition in `hairness.json`. Extensions can
provide static skills or an explicitly approved Adapter whose staged outputs
are checked by path, owner and digest.

Targets remain independent Git repositories linked locally after remote
verification. Catalogs are optional JSON indexes over exact npm or Git specs,
so direct installation works before a web marketplace exists.

I would value feedback on the package contract and Adapter trust boundary.

## Reddit

### Title

Hairness 0.4 alpha: composing agent Homes from exact npm and Git packages

### Body

I have been rebuilding Hairness around a smaller model.

A Home is an npm project. A Starter supplies the initial composition;
Extensions contribute provider-neutral skills or controlled build outputs; an
optional Catalog indexes exact packages. `package-lock.json` is the only lock.
Hairness generates native Codex and Claude assets and refuses edited or
colliding owned output.

The design keeps product repositories outside the harness as independent
Targets. Team-specific behavior stays in separate packages instead of expanding
the Kernel.

The alpha is tested on two real Homes and a private team Starter with a pinned
GSD Adapter. I am looking for criticism of the lifecycle and security model
before widening the surface.
