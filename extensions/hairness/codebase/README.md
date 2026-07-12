# hairness/codebase

## Value and use cases

Makes repository identity, mounts, status and architecture maps explicit to an agent.

## Selection and setup

Selected by standard and forge. Codebases are declared by the distribution and mounted locally.

## Capabilities and operations

Owns list, show, doctor, map, entrypoint and system inspection plus the `inspect` service.

## Inputs, controls and results

Accepts codebase IDs and mapping focus. Map operations return typed `codebase-map` artifacts.

## State and artifacts

Mounts remain local. Maps are revisioned artifacts and must be revalidated against live Git evidence.

## Effects and safety

Inspection is read-only. A map never confers target authority.

## Providers

Projects `hairness-codebase` as the namespace guide. Codebase map routes remain available internally and through structure-oriented intents.

## Tests and maturity

Official alpha. Tests cover requiredness, mounts, remote identity and map producers.
