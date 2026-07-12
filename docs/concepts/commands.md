# Commands

The CLI is the deterministic machine interface. Provider commands are the human
cockpit controls compiled from extension-owned command definitions.

A capability command exposes a complete namespace. An intent preset binds a
frequent action, default mode, budget, result contract, and argument-resolution
policy. A preset cannot grant mutation authority or bypass a checkpoint.

Commands may opt into extension-owned intent modifiers such as `--present`. A quick command composes operation, focus, source policy, boundary, execution mode, budget, and accepted modifiers. It does not duplicate the underlying capabilities.
