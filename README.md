# Hairness

## Stop rebuilding your agent setup for every project and provider.

Hairness turns agent instructions, commands, source access, safeguards, methods, and result contracts into versioned **agentic assets**. Select them once, own the source, and compile the same operating environment for Codex and Claude.

It is not another AI tool. It is the lightweight layer that makes your preferred AI tools understand how you work.

**Shared reality. Shared cognition. Safe leverage.**

Status: **pre-alpha** · Implementation: **0.2.0-alpha.0** · Protocol: **0.2** · Node.js: **22+** · License: **MIT** · Providers: **Codex, Claude**

The name is a joke. The context discipline isn't.

## Work with the main session

Hairness is designed for the session where human judgment and model inference meet. The human provides intent, taste, priorities, and decisions. The agent provides synthesis, reach, continuity, and execution. Deterministic controls keep both grounded in the same sources, boundaries, and results.

Provider commands are the human interface:

```text
hairness                         route an intent
hairness-help                    show the active surface
hairness-onboarding              configure one decision at a time
hairness-wake-up                 show current attention

hairness-work                    inspect or steer persistent work
hairness-discuss                 reason without effects
hairness-recap                   preserve a segment digest
hairness-plan                    produce an accepted work plan
hairness-act                     apply one bounded frame
hairness-execute                 execute an accepted plan

hairness-map                     organize known relationships
hairness-explain                 clarify a concept
hairness-compare                 put options in tension
hairness-ideate                  explore possibilities
hairness-propose                 converge on a recommendation

hairness-codebase                inspect mounted repositories
hairness-map-codebase            map a codebase with a bounded producer
hairness-source                  read selected deterministic sources
hairness-check-sources           resolve proof gaps
hairness-constraint              narrow the allowed boundary
hairness-session                 inspect local session continuity
hairness-handoff                 preserve meaning without a transcript
hairness-update                  propose source-owned updates
hairness-maintain                maintain and qualify a forge
```

Codex invokes `$hairness-…`; Claude invokes `/hairness-…`. Each name maps to the same extension-owned operation. Modifiers such as `--present auto` and `--creative divergent` compose behavior without duplicating capabilities.

## Agentic assets are software

“Skill”, “prompt”, “hook”, “MCP”, “worker”, and “CLI” describe delivery mechanisms. **Agentic asset** names the durable thing: a versioned unit that changes what an agent can understand or do.

Hairness gives executable assets a small common grammar:

```text
AgenticAsset
└── Capability
    └── Operation: observe | derive | effect
        └── Route: deterministic | inline | worker | external
            └── typed Result
```

- A **capability** defines one coherent ability.
- An **operation** says whether it observes, derives, or causes effects.
- A **route** says where the operation runs.
- A **typed result** makes validation, fan-in, reuse, and recovery possible.

The kernel owns this grammar and its guarantees. Extensions own every behavior. A distribution owns what is selected.

## Create once, project everywhere

The npm alpha is not published yet. The intended flow is:

```bash
npx @hairness/hairness@next create ./acme-hairness
cd acme-hairness
npm install
hairness onboarding next
```

The wizard asks one question at a time, presents one checkpoint, initializes local Git, and compiles repo-local provider surfaces. It never creates a commit, remote, push, tag, release, or publication.

Three recipes define the initial payload:

| Recipe | Includes | Excludes |
| --- | --- | --- |
| `minimal` | kernel, cockpit, distribution lifecycle | Work Controls, sources, maintainer, dormant catalogue |
| `standard` | composable controls, sessions, codebases, Git source driver | maintainer and dormant drivers |
| `forge` | standard, maintainer, complete generic catalogue | private company assets |

Create a forge explicitly:

```bash
npx @hairness/hairness@next create ./acme-agent-forge --preset forge
```

A generated distribution receives its own README and configuration, selected source only, and the MIT notice required for vendored Hairness code. It does not inherit Hairness's SPEC, STATUS, roadmap, maintainer documentation, project license, or dormant catalogue.

## Source-owned from day one

Hairness follows the open-code model popularized by shadcn/ui: generation transfers practical ownership to the consumer. The result is a standalone repository, not a thin client tied to an upstream service.

`hairness.lock.json` records the recipe, provenance, selected materials, and base digests. Updates are explicit proposals:

```bash
hairness update check
hairness update plan --scope extension:hairness/cockpit
hairness update apply <plan-id> --checkpoint <id>
```

Intact owned material can be updated mechanically. Consumer divergence, dependency changes, or edited managed regions require review. Hairness never performs a silent merge or Git mutation.

## Extensions own behavior

The standard distribution composes narrow controls:

- **Cockpit** renders help, onboarding, opening, and wake-up.
- **Work Controls** preserve mission, segment, frame, decisions, recap, plan, and execution trajectory.
- **Understanding Controls** own map, explain, and compare.
- **Ideation Controls** own ideate, propose, and creative strategies.
- **Presentation Controls** select the smallest useful views without changing meaning.
- **Constraints** narrow effects across session, segment, frame, and operation.
- **Session Intelligence** preserves semantic handoffs, never transcripts.
- **Codebase** identifies exact repositories and named checkouts.
- **Sources** validates evidence from selected read-only drivers.

Extensions can also adapt execution loops, MCP servers, domain methods, or company workflows. Hairness does not replace those runtimes; it gives them explicit operations, authority, results, and provider projections.

## Sources prove current truth

The `hairness/sources` extension owns one engine for discovery, evidence, redaction, and freshness. Drivers are selected assets, not hardcoded kernel behavior.

```text
minimal   -> no driver
standard  -> git
forge     -> git active; git, jira, gitlab, aws available in the catalogue
```

Local CLIs provide deterministic proof. MCP and provider connectors can be adapters, but do not become truth merely because they are convenient. Artifacts orient; live sources prove.

## Native providers, bounded workers

Hairness compiles active operations into tracked repo-local surfaces:

```text
Codex   -> AGENTS.md, .agents/skills, .codex hooks and workers
Claude  -> CLAUDE.md, .claude skills, hooks and workers
```

The provider keeps its model, UI, sandbox, tools, native subagents, and thread visibility. A producer receives a bounded observe/derive capsule. An executor receives an effect operation plus an exact grant. Neither receives the main-session cockpit.

No fan-out completes without fan-in. The main session gets a compact typed result, proof, limits, and valid next routes—not worker noise.

## Lightweight by construction

- One Node.js CLI; no daemon or proprietary agent runtime.
- JSON contracts and local files; no mandatory service.
- Repo-local projections; no plugins, marketplaces, or global install state.
- Deterministic work where inference adds no value.
- Native model inference where judgment and creativity do add value.
- `.overlay/` for ignored local runs, mounts, artifacts, and extension state.

## Safety

**Non-invasive integration. Explicit operation.**

- Selecting an extension, command, source, mount, artifact, or worker grants no authority.
- Observe and derive operations cannot request effects.
- Effects require an exact checkpoint, current policy, worker capsule, target, and valid lock.
- Tightening a constraint invalidates an incompatible grant.
- Hairness stores no transcript, hidden reasoning, secret, credential, customer data, or production data.
- Provider and source limitations remain explicit.

## Documentation

- [Protocol specification](SPEC.md)
- [Architecture](docs/architecture.md)
- [Agentic assets](docs/concepts/agentic-assets.md)
- [Capabilities and operations](docs/concepts/capabilities.md)
- [Composable controls](docs/concepts/composable-controls.md)
- [Main session](docs/concepts/main-session.md)
- [Extensions](docs/extensions/README.md)
- [Provider projections](docs/adapters.md)
- [Security](docs/security-model.md)
- [Current status](STATUS.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
npm install
hairness opening --json
hairness build --check
npm run check
npm test
npm run conformance
npm run check:pack
```

Hairness is licensed under the [MIT License](LICENSE).

**Keep the model native. Make the operating system yours.**
