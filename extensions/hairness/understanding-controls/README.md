# hairness/understanding-controls

## Value and use cases

Provides reusable map, explain and compare primitives for main-session reasoning.

## Selection and setup

Selected by standard and forge and composed with Presentation Controls.

## Capabilities and operations

Owns map, explain and compare. Domain extensions supply their own subjects and sources.

## Inputs, controls and results

Requires one typed focus and accepts explicitly supported presentation modifiers. A missing focus becomes one Hairness gap before inference.

## State and artifacts

No state is persisted unless the operation selects an owner-declared artifact result.

## Effects and safety

Understanding operations cannot invent evidence or request effects.

## Providers

Projects `hairness-x-show-structure` as the provider-facing structure intent. `map`, `explain` and `compare` remain internal operation routes.

## Tests and maturity

Official alpha. Tests preserve focus, modifiers and operation ownership.
