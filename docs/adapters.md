# Provider projections

Hairness compiles active extension commands into files that Codex and Claude discover natively. These files are projections with loss: the provider sees skills or slash commands, while Hairness keeps the canonical distinction between bridge, namespace guide, intent command, operation, result and CLI route.

| Logical surface | Codex | Claude |
| --- | --- | --- |
| Guidance | `AGENTS.md` | `CLAUDE.md` |
| Commands | `.agents/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` |
| Workers | `.codex/agents/*.toml` | `.claude/agents/*.md` |
| Session opening | `.codex/hooks.json` | `.claude/settings.json` |
| Project limits | `.codex/config.toml` | Claude settings and worker tools |

The shared projection is versioned. A fresh clone needs only dependency installation, onboarding, provider trust for hooks, and a new provider session.

Provider commands use one semantic path on both hosts: infer a compact draft, set the command's named `resultId` when declared, submit it to `hairness invoke start`, ask only a returned gap, then render the typed result. `hairness-x-*` commands are chat-first one-intent commands. `make-*` requests `result=response`; `save-*` requests `result=artifact`. `--auto` advances progress only and never changes persistence. Hairness does not claim a deterministic prompt-interception hook where the provider exposes none. In that case `host doctor` reports the honest `guarded` `agent-first-call` path; `strict` is reserved for a verified native fast hook.

Provider state is evidence-based: `projected` means files exist, `verification-required` means onboarding is applied but a new trusted task has not executed the hook, and `verified` requires a compatible local SessionStart receipt. `blocked` and `stale` are never reported as ready.

```bash
hairness build                 # reconstruct both shared projections
hairness build --provider codex
hairness build --local         # include trusted local extensions under .overlay
hairness build --check         # detect missing, stale, or edited outputs
hairness host doctor codex
hairness host doctor claude
```

## Managed ownership

Markdown and TOML use content-addressed managed regions. JSON uses owned entries recorded in `hairness.build.json`. The compiler preserves all foreign content and returns `review-required` when an owned entry changed outside its canonical extension source.

`hairness clean` removes only intact owned outputs and regions. It never removes foreign keys or human content.

## Worker isolation

Both providers receive protocol-owned `hairness-producer` and `hairness-executor` profiles. A worker receives only its capsule, including its `fast|balanced|deep` workload; shared projections never hardcode a model. A worker may not load the main-session cockpit or spawn nested workers. The provider retains native thread visibility; Hairness validates the result and performs fan-in.

Plugins, marketplaces, global registrations, attachments, and absolute symlinks are not part of protocol 0.2.
