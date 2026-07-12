# Commands

The CLI is the deterministic machine interface. Provider commands are the human controls compiled from active extensions.

Providers do not model Hairness's full command grammar. A Codex skill or Claude
slash command can only approximate the internal distinction between bridge,
namespace guide, intent command, operation and CLI route. Hairness keeps that
meaning in metadata and naming:

- `surface=bridge`: the root router, currently `hairness`;
- `surface=namespace`: a guide for a command namespace such as `hairness-work`;
- `surface=intent`: a one-intent human command, always prefixed `hairness-x-*`;
- `surface=specialized`: exact lifecycle or diagnostic purpose.

Capability and preset commands reference an OperationRef. They can set
`resultId`, prefill controls, provide defaults, and accept modifiers, but cannot
grant effects or approve checkpoints.

The standard alpha surface exposes 24 commands with exact Codex/Claude parity:
the bridge, cockpit helpers, namespace guides, and the `hairness-x-*` intent
nucleus. `make-*` commands request `result=response`; `save-*` commands request
`result=artifact`. `--auto` advances progress only and never changes
persistence.

Removing an extension removes its commands at the next build. Internal CLI
routes remain available for machine/debug use even when they are not projected
as human-facing provider commands.
