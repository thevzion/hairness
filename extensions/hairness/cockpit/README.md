# hairness/cockpit

## Value and use cases

Provides the main-session router, help, onboarding entrypoint and compact wake-up surface.

## Selection and setup

Selected by every built-in recipe. Workspace trust is required before extension contributions run.

## Capabilities and operations

Owns cockpit help, onboarding routing and attention rendering. Other extensions own the signals it displays.

## Inputs, controls and results

Consumes bounded attention and session contributions and returns concise human-facing status.

## State and artifacts

Reads shared runtime state but owns no domain artifact or transcript.

## Effects and safety

Routing never grants authority. Wake-up exposes limits and blocked routes.

## Providers

Owns the primary Hairness, help, onboarding and wake-up commands for Codex and Claude.

## Tests and maturity

Official alpha. Tests cover attention ownership, legacy runs and compact rendering.
