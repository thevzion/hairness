# Commands

The CLI is the deterministic machine interface. Provider commands are the human controls compiled from active extensions.

Providers do not model Hairness's full command grammar. A Codex skill or Claude
slash command can only approximate the internal distinction between bridge,
namespace guide, intent command, operation and CLI route. Hairness keeps that
meaning in metadata and naming:

- `surface=bridge`: the root router, currently `hairness`;
- `surface=namespace`: a guide for a command namespace such as `hairness-work`;
- `surface=intent`: a one-intent human command, always prefixed `hairness-cmd-*`;
- `surface=specialized`: exact lifecycle or diagnostic purpose.

`CommandSurfaceSpec` is provider-independent. An intent surface declares its
verb/object/qualifiers lexeme, OperationRef, named result, arguments, immutable
controls, defaults, modifiers and instruction source. Provider names and the
ResultContract are derived rather than duplicated in manifests.

The standard alpha surface exposes 29 commands with exact Codex/Claude parity:
the bridge, cockpit helpers, namespace guides, and the `hairness-cmd-*` intent
nucleus. `make-*` requests a typed response. `save-*` promotes the last
compatible result without resynthesis. `promotion=none|artifact|effect` is
separate from progress; `--auto` changes progress only and grants no authority.

Removing an extension removes its commands at the next build. Internal CLI
routes remain available for machine/debug use even when they are not projected
as human-facing provider commands.
