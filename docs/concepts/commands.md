# Commands

The CLI is the deterministic machine interface. Provider commands are the human controls compiled from active extensions.

A provider command is one of:

- `bridge`: the main router;
- `capability`: a direct operation surface;
- `preset`: a frequent composition with fixed/default values.

Capability and preset commands reference an OperationRef. They can prefill mode, budget, focus, and accepted modifiers, but cannot grant effects or approve checkpoints.

The standard composition exposes 24 commands with exact Codex/Claude parity. Removing an extension removes its commands at the next build.
