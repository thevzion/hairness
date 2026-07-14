# hairness/session-intelligence

## Value and use cases

Preserves compact session continuity across providers without storing conversations.

## Selection and setup

Selected by standard and forge. Transcript input is optional, temporary and allowlisted.

## Capabilities and operations

Owns local sessions, provider associations, digest, reconcile and handoff
operations. The declared `current` service gives dependent extensions a stable
local session identity without exposing provider conversation history.

## Inputs, controls and results

Accepts a local session and optional provider reference and returns typed digests or handoffs.

## State and artifacts

Stores local session associations and validated digests. Transcript inboxes are deleted after processing.

## Effects and safety

No provider transcript or internal reasoning is durable.

## Providers

No standalone provider command is projected in the alpha surface. Session inspection and handoff remain available through deterministic CLI routes.

## Tests and maturity

Official alpha. Tests cover digest promotion, inbox deletion and unbound sessions.
