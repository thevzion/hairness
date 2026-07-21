# Hairness 0.4 technical reference

Hairness 0.4 is an alpha. The JSON schemas under `schemas/v4` define the machine
contracts. This page defines the human-readable contract.

## Home

`hairness.json` requires a name, an exact CLI runtime and one or more providers.
Hairness omits empty optional fields.

```json
{
  "$schema": "https://hairness.dev/schema/home.json",
  "name": "my-home",
  "runtime": "@hairness/cli@0.4.0-alpha.0",
  "providers": ["codex", "claude"]
}
```

Optional `targets`, `integrations` and `config` fields hold shared composition.
New Homes ignore `.overlay/`, `targets/` and `.hairness/`. Provider projections
remain tracked.

`create <home> [base-asset]` creates a Git repository, installs
`@hairness/onboarding`, optionally installs the base Asset, builds provider
projections, runs doctor and creates one initial commit. `init` writes a bare
Home without an Asset, build or commit.

## Asset

An installed Asset lives at
`assets/<namespace>/<name>/hairness.json`. The `name` field must match the
two path segments. Its `files` may use these alpha types:

- `hairness:instruction` for provider-neutral operating context;
- `hairness:skill` for a named, described capability;
- `hairness:file` for knowledge, examples, templates and Adapter source.

A Skill requires `id` and `description`. Other file types reject those fields.
The optional `adapter` declares an id, entry file and output roots.

Hairness adds `installation` during `add` or `sync`. It records the source,
requested Git reference, resolved commit, mobility, canonical source-manifest
digest and a base digest for each file. Source manifests omit this field.

An installed Asset may itself be used as a local, HTTPS or Git source. Hairness
removes its previous `installation` block before validation and records fresh
provenance in the receiving Home.

Supported addresses:

```text
@hairness/onboarding
@hairness/scratch
owner/repository/path#tag
owner/repository/path#40-character-commit
owner/repository/path
https://example.com/path/hairness.json
./path/to/hairness.json
```

Git tags and full commits count as pinned. An unpinned GitHub address, HTTPS
manifest or local path counts as mobile.

## Lifecycle

`add` resolves all requested Assets, validates every manifest and source
file, previews writes and applies one transaction after confirmation. It rejects
existing destinations unless the user passes `--overwrite`. It executes no
Asset code.

`status` works offline. It compares the source part of the manifest and every
declared file with installation digests, then returns `clean`, `customized`,
`missing` or `invalid`.

`diff` fetches the current or selected source and reports additions, changes and
removals. `sync --check` reports availability without writing. `sync` updates a
clean Asset in one transaction. A local modification blocks the transaction
unless the user passes `--overwrite`. Hairness preserves undeclared local files.

`remove` deletes the manifest and the files recorded in `baseDigests`. It
preserves undeclared files and refuses local divergence unless the user passes
`--overwrite`.

The lifecycle commands do not build provider projections. The caller invokes
`build` after the accepted source change.

The legacy `extensions/` layout and Extension schema are rejected. Hairness
does not discover or migrate them implicitly.

## Ownership

Private or uncertain work belongs in `.overlay/`. Knowledge owned by an Asset
belongs under that Asset, conventionally in `knowledge/`. Knowledge about a
Target remains in that independent repository. A Home-level `docs/` directory
documents the Home itself and is not a general knowledge store.

Promotion from Overlay to Asset or Target requires explicit consent. Generated
provider projections are never canonical sources.

## Build

`build` discovers `assets/*/*/hairness.json`, composes instructions and
projects Skills to `.agents/skills` and `.claude/skills`. It maintains bounded
regions in `AGENTS.md` and `CLAUDE.md`, plus exact-runtime session hooks.

`.hairness/build.json` records generated output owners and digests. A clone can
run `build --check` without this local state because tracked projections contain
the expected bytes. Hairness refuses edits to outputs it owns.

An Adapter remains inert until `build --allow-adapter <id>`. Hairness executes
the entry with a minimal environment and a bounded output directory. It limits
time and output size, rejects symlinks, undeclared outputs, reserved Kernel
outputs and owner collisions, then reconciles staged files.

## Targets and Integrations

A Target declaration stores a normalized Git remote. A local binding under
`targets/` points to the independent checkout. Prologue reports the remote,
binding, branch and clean state. Hairness never imports the Target into the Home
repository.

An Integration declares acceptable CLI or provider accessors. The local Overlay
stores the selected accessor per provider. Hairness does not install or
authenticate external tools.

## Prologue and doctor

`prologue` emits bounded preferences, facts and signals for session orientation.
It excludes secrets and treats live evidence as a signal, not a guarantee.

`doctor` validates runtime, Assets, Targets, Integrations and generated
outputs. A customized Asset remains healthy after a matching build; missing
or invalid source files block readiness. Doctor reports `ready` or `partial`
with repair routes.
