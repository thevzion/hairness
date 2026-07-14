# hairness/codebase

## Value and use cases

Makes repository identity, mounts, status and architecture maps explicit to an agent.

## Selection and setup

Selected by standard and forge. Codebases are declared by the distribution and mounted locally.

## Capabilities and operations

Owns list, show, doctor, map, entrypoint and system inspection plus `inspect`,
`mount-managed` and `unmount-managed` services. Worktree Controls uses the
managed services only for registered external codebases.

## Inputs, controls and results

Accepts codebase IDs and mapping focus. Map operations return typed `codebase-map` artifacts.

## State and artifacts

Mounts remain local. Maps are revisioned artifacts and must be revalidated against live Git evidence.

## Effects and safety

Inspection is read-only. A map never confers target authority. Managed mount
services require the calling Run, effect and exact credential-free target and
revalidate them through `authority.assert` before changing overlay state.
Unmounting always preserves the checkout.

## Providers

Projects `hairness-codebase` as the namespace guide. Codebase map routes remain available internally and through structure-oriented intents.

## Tests and maturity

Official alpha. Tests cover requiredness, mounts, exact Run authority, remote
identity and map producers.
