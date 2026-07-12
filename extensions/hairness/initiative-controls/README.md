# hairness/initiative-controls

## Value and use cases

Keeps the forge's macro initiatives, outcomes, gates, evidence and links explicit without becoming a project manager.

## Selection and setup

Forge-only and source-owned. State stays local until an explicit publication route is checkpointed.

## Capabilities and operations

Owns initiative status, list, show, open, close and roadmap snapshot planning.

## Inputs, controls and results

An initiative needs a stable slug, outcome and release gate. Publication returns a bounded executor route, never a direct write.

## State and artifacts

Local trajectory is append-only under the extension overlay. `STATUS.md` is only a reviewed snapshot.

## Effects and safety

Open and close mutate owner-scoped local state. Publishing a versioned snapshot requires explicit filesystem authority.

## Providers

No standalone provider command is projected in the alpha surface. Roadmap inspection remains available through deterministic CLI routes.

## Tests and maturity

Experimental alpha. Tests cover one active initiative, evidence, snapshot checkpoints and absence of Git effects.
