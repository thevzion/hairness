# hairness/constraints

## Value and use cases

Keeps read-only, no-Git and no-external boundaries explicit across a work trajectory.

## Selection and setup

Selected by standard and forge and depends on Work Controls for active scopes.

## Capabilities and operations

Owns show, set, clear and effective-policy resolution.

## Inputs, controls and results

Constraints apply at session, segment, frame or operation scope and only tighten downward.

## State and artifacts

Constraint state is local and owner-scoped. It does not create semantic artifacts.

## Effects and safety

Constraints deny effects; they never grant authority. `no-git` covers local Git and GitHub mutations. Grants remain operation-scoped core records.

## Providers

No standalone provider command is projected in the alpha surface. Constraint inspection and changes remain available through deterministic CLI routes.

## Tests and maturity

Official alpha. Tests cover inheritance and grant revocation after tightening.
