# Provider compilation

Hairness currently compiles the same active recipes for Codex and Claude.

| Provider | Native projection | Command syntax |
| --- | --- | --- |
| Codex | `.agents/skills/<command>/SKILL.md` | `$hairness-…` |
| Claude | `.claude/skills/<command>/SKILL.md` | `/hairness-…` |

Generated skills are local build output. Runtime `build.json` records each exact
path, owner, provider, and digest. Build writes only those entries into the Home
repository's `.git/info/exclude`. It preserves unmanaged provider files and
user-authored skills.

`AGENTS.md` and `CLAUDE.md` use one small managed region. All surrounding content
is user-owned. A rebuild refuses edited generated outputs instead of silently
destroying divergence.

Clone recovery is deterministic:

```bash
npm install
hairness build
hairness doctor
```

The compiler owns syntax only. Recipes and capabilities remain provider-neutral;
the provider retains model execution, UI, sessions, tools, and native execution.

Effect adapters use `prepare` and `apply`. If an adapter can prove that an effect
was only partial, it returns `effectOutcome('partial', evidence)` from the runtime
operation module. Hairness consumes the checkpoint, writes the immutable Receipt,
and blocks replay until a human reconciles it. An exception is conservatively
recorded as an unknown outcome.
