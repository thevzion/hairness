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

The standard alpha surface exposes 30 commands, including the Worktree
namespace. The forge adds five Delivery Controls for 35 total commands, with
exact Codex/Claude parity. `make-*`
requests a typed response. `save-*` promotes the last compatible result without
resynthesis. `want-ship` drafts a brief; `ship-it` and the specialized PR,
merge, and release commands expose one next boundary. `promotion=none|artifact|effect`
is separate from progress; `--auto` changes progress only and grants no
authority. A natural `go` can approve only the stored checkpoint currently
shown by the agent.

`hairness-worktree` is the single human namespace for checkout status,
inspection, doctor, creation, adoption, synchronization, handoff, takeover,
closure, repair, reconciliation and pruning. Mutating actions return a preview
and exact checkpoint; `--auto` never supplies their authority.

Removing an extension removes its commands at the next build. Internal CLI
routes remain available for machine/debug use even when they are not projected
as human-facing provider commands.
