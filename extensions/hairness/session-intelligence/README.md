# hairness/session-intelligence

## Value and use cases

Preserves compact session continuity across providers without storing conversations.

## Selection and setup

Selected by standard and forge. Transcript input is optional, temporary and allowlisted.

## Capabilities and operations

Owns local sessions, provider associations, digest, reconcile and handoff operations.

## Inputs, controls and results

Accepts a local session and optional provider reference and returns typed digests or handoffs.

## State and artifacts

Stores local session associations and validated digests. Transcript inboxes are deleted after processing.

## Effects and safety

No provider transcript or internal reasoning is durable.

## Providers

Projects `hairness-session` and `hairness-handoff` to Codex and Claude.

## Tests and maturity

Official alpha. Tests cover digest promotion, inbox deletion and unbound sessions.
