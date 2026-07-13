# Hairness

**The intent control layer for native AI agents.**

Hairness turns instructions, commands, source access, safeguards, methods, and
result contracts into versioned **agentic assets**. Select them once, own their
source, and compile the same operating environment for Codex and Claude.

**Move mountains with one intent.**

> [!WARNING]
> **Experimental alpha.** Hairness is ready for evaluation and dogfooding, but
> its protocol, commands and extension contracts may change before 1.0.
> Pin exact versions, keep effects checkpointed and expect documented migrations.

Implementation: **0.2.0-alpha.0** · Protocol: **0.2** · Node.js: **22+** ·
License: **MIT** · Providers: **Codex, Claude**

The name is a joke. The context discipline isn't.

## Stop rebuilding your agent setup

Starting a project still means copying skills, rewriting instructions, wiring
tools, and teaching each AI provider the same context. Teams then accumulate
prompts and scripts that are hard to test, version, reuse, or trust.

Hairness adds one small layer above native agents. It gives humans a stable
intent surface and gives agents deterministic routes to current context,
sources, constraints, artifacts, and typed results. The provider keeps its
model, UI, sandbox, tools, and native workers.

**Repositories are targets. Hairness is the agent's home.**

**Shared reality. Shared cognition. Safe leverage.**

## Control the main session

The main session is where human judgment and model inference meet. The human
brings intent, taste, priorities, and decisions. The agent brings synthesis,
reach, continuity, and execution. Hairness keeps both grounded without turning
the conversation into infrastructure work.

Provider commands are a lossy native projection of Hairness's richer internal
model. Providers expose “skills” or slash commands; Hairness distinguishes the
bridge, namespace guides, human intent commands, operations, and CLI routes:

```text
hairness                         bridge: route an intent
hairness-help                    namespace guide: show the active surface
hairness-work                    namespace guide: active work
hairness-source                  namespace guide: deterministic proof
hairness-codebase                namespace guide: registered repositories

hairness-cmd-show-topics         recover work across sessions
hairness-cmd-show-method         show the method and work-segment shape
hairness-cmd-show-work           show active work and open invocations
hairness-cmd-show-trace          trace Invocation -> Runs -> result
hairness-cmd-open-frame          open one bounded frame
hairness-cmd-discuss             discuss without effects
hairness-cmd-check-sources       resolve proof gaps
hairness-cmd-show-structure      map the structure needed to understand
hairness-cmd-compare-options     compare explicit options
hairness-cmd-ideate              explore divergent directions
hairness-cmd-propose             converge on one recommendation
hairness-cmd-propose-creative    make one lateral recommendation
hairness-cmd-make-recap          return a chat SegmentDigest
hairness-cmd-save-recap          promote that exact SegmentDigest
hairness-cmd-make-plan           return a chat WorkPlan
hairness-cmd-save-plan           promote that exact WorkPlan
hairness-cmd-show-next           show next routes
hairness-cmd-ask-next            ask the next unblocking question
hairness-cmd-plan-system-wire    plan system wiring
hairness-cmd-plan-system-shape   plan target shape / reshape-system
hairness-cmd-do-frame            act through a checkpoint
hairness-cmd-do-plan             execute an accepted plan
```

Codex invokes `$hairness-…`; Claude invokes `/hairness-…`. `make-*` stays in
chat. `save-*` promotes the last compatible typed result. `--auto` advances
progress only; it never changes promotion or authority. The CLI remains the deterministic machine
surface for exact routes such as `hairness work status --json`.

## Hairness in action

Commands compress intent. The model infers a draft, Hairness resolves what is
already known, and the human is asked only for an irreducible decision.

### Resolve one real gap

```text
Human: $hairness-cmd-show-structure
Hairness: What should be mapped?
Human: The provider projection flow.
Agent: [submits the resolved invocation and renders the typed map]
```

The missing focus produces one structured gap, not an improvised interview.
This behavior is covered by the
[invocation gap test](tests/invocation.test.mjs).

### Preserve meaning, not conversation noise

```text
Human: $hairness-cmd-make-recap --present compact
Agent: [renders a chat-first recap dashboard]
Human: save it
Agent: [uses $hairness-cmd-save-recap and promotes that exact SegmentDigest]
```

The result passes its owner schema and fan-in before it reaches the main
session. See the
[recap and resume fixture](extensions/hairness/maintainer/testing/test-suites/work-controls-recap-resume/test.mjs).

### Stop before an effect

```text
Human: $hairness-cmd-do-frame --auto
Hairness: resolved the target and constraints; needs authority
Agent: [shows the exact checkpoint instead of mutating the target]
```

`--auto` removes safe mechanical pauses. It never bypasses trust, ambiguity,
authority, target expansion, or result validation. See the
[effect-gate fixture](extensions/hairness/maintainer/testing/test-suites/provider-plan-effect-gate/test.mjs).

The design goal is simple: hide the mechanics and surface the judgment.

## Agentic assets are software

“Skill”, “prompt”, “hook”, “MCP”, “worker”, and “CLI” describe delivery
mechanisms. **Agentic asset** names the durable thing: a versioned unit that
changes what an agent can understand or do.

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

The kernel owns this grammar and its guarantees. Extensions own behavior. A
distribution owns the selection.

## Intent mode and direct mode

Natural commands and explicit automation share one Invocation Engine:

```text
intent -> draft -> deterministic resolution -> preview -> route -> result gate -> receipt
```

In intent mode, the native model proposes a draft and submits it before asking
a question. In direct mode, a script provides the canonical operation and
inputs. Both modes create the same request, append-only events, hard gates, and
receipt. Child Runs share the Invocation root and complete it at fan-in.
Hairness does not contain a model or store provider output.

Controls such as `--present auto` and `--creative divergent` change strategy or
rendering without changing available evidence. Persistent session, segment,
and frame controls remove repeated prose while constraints can only narrow the
allowed boundary.

## Recover work, not transcripts

Hairness derives an Attention Index from active work, open Invocations and
Runs, stale proof, recent typed results, and the open edges of closed segment
digests. `wake-up` injects only the top three signals;
`hairness-cmd-show-topics` exposes up to twenty recoverable subjects; and
`hairness-cmd-show-trace` shows the current Invocation tree.

The Semantic Ledger stores semantic requests, events, result digests, proof,
limits and receipts. It stores no transcript, hidden reasoning, or raw provider
response. Free conversation and direct third-party skill calls remain outside
this guarantee.

## Create a source-owned distribution

The npm alpha is not published yet. After publication under the `next` tag, the
bootstrap will be:

```bash
npx @hairness/hairness@next create ./acme-hairness
cd acme-hairness
npm install
hairness onboarding next
```

Until then, clone this repository to evaluate the forge itself. The wizard asks
one question at a time, presents one checkpoint, initializes local Git, and
compiles repo-local provider surfaces. It never creates a commit, remote, push,
tag, release, or publication.

| Recipe | Includes | Excludes |
| --- | --- | --- |
| `minimal` | kernel, cockpit, distribution lifecycle | Work Controls, sources, maintainer, dormant catalogue |
| `standard` | composable controls, sessions, codebases, Git source driver | maintainer and dormant drivers |
| `forge` | standard, maintainer, complete generic catalogue | private company assets |

A generated distribution receives its own README and configuration, selected
source only, and the MIT notice required for vendored Hairness code. It does not
inherit Hairness's SPEC, STATUS, roadmap, maintainer documentation, project
license, or dormant catalogue.

## Source-owned from day one

Hairness follows the open-code model popularized by shadcn/ui. Generation
transfers practical ownership to the consumer. The result is a standalone
repository, not a thin client tied to an upstream service.

`hairness.lock.json` records provenance, selected materials, dependencies, and
base digests. Updates are explicit proposals:

```bash
hairness update check
hairness update plan --scope extension:hairness/cockpit
hairness update apply <plan-id> --checkpoint <id>
hairness migrate status
hairness migrate plan --to current
hairness migrate apply <plan-id> --checkpoint <id>
```

Intact owned material can be updated mechanically. Versioned migrations first
transform a scratch copy of owned local state, validate it, then apply through
an exact checkpoint and receipt. Consumer divergence, dependency changes,
local extension ownership, or edited managed regions require review. Hairness
never performs a silent merge, arbitrary consumer codemod, or Git mutation.

## Build an extension without provider internals

Extensions own their capabilities, operations, commands, instructions,
resolvers, results, schemas, documentation, and tests. A local extension can be
created and evaluated without knowing Codex or Claude formats:

```bash
hairness extension init --local acme/review-controls
hairness extension link --local acme/review-controls --from ../review-controls
hairness build --local
hairness extension doctor acme/review-controls
```

Promotion into a distribution is an explicit, checkpointed source transfer.
Presence in a catalogue or filesystem never enables an extension and never
grants authority. See the [extension authoring guide](docs/extensions/README.md)
and [official catalogue](docs/extensions/catalog.md).

The standard distribution demonstrates independent Controls for work,
understanding, ideation, presentation, constraints, sessions, codebases, and
sources. A forge can add company methods, game design workflows, sales
operations, execution loops, or other domain assets using the same contracts.

## Native providers and external adapters

Hairness compiles active operations into tracked, repo-local surfaces:

```text
Codex   -> AGENTS.md, .agents/skills, .codex hooks and workers
Claude  -> CLAUDE.md, .claude skills, hooks and workers
```

A producer receives a bounded observe or derive capsule. An executor receives
an effect operation plus an exact grant. Neither receives the main-session
cockpit or transcript. No fan-out completes without fan-in.

CLIs, MCP servers, connectors, execution loops, and frameworks remain native to
their runtime. Hairness can expose them as source or external routes with typed
inputs, authority, results, and limits. It does not replace them.

This is the shift from prompting agents to operating agentic systems, while
keeping the model inside the tool built for it.

## Lightweight by construction

- One Node.js CLI; no daemon or proprietary agent runtime.
- JSON contracts and local files; no mandatory service.
- Repo-local projections; no plugins, marketplaces, or global install state.
- Deterministic work where inference adds no value.
- Native model inference where judgment and creativity do add value.
- `.hairness/` for shared policies and assets.
- `.overlay/` for ignored invocations, sessions, controls, runs, and scratch.
- `~/.hairness/` for personal preferences and trust.

## Risky operations stay explicit

**Non-invasive integration. Explicit operation.**

- Selecting an extension, command, source, mount, artifact, or worker grants no authority.
- Observe and derive operations cannot request effects.
- Effects require an exact checkpoint, current policy, worker capsule, target, and valid lock.
- Tightening a constraint invalidates an incompatible grant.
- Partial or unknown effects stop recovery and quarantine the affected target.
- Hairness stores no transcript, hidden reasoning, secret, credential, customer data, or production data.
- Provider and source limitations remain explicit.

## Community and contributing

Hairness is testing whether agentic assets can become portable, inspectable
software across providers and domains. Proposals are welcome as extensions,
provider reports, protocol RFCs, and executable documentation. Community assets
remain in their own repositories; discovery does not imply trust or authority.

Read [CONTRIBUTING.md](CONTRIBUTING.md), the
[extension catalogue](docs/extensions/catalog.md), and the
[known limitations](docs/known-limitations.md) before proposing a change.

## Documentation

- [Protocol specification](SPEC.md)
- [Architecture](docs/architecture.md)
- [Agentic assets](docs/concepts/agentic-assets.md)
- [Invocations](docs/concepts/invocations.md)
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

Hairness is licensed under the [MIT License](LICENSE). Security reports follow
the process in [SECURITY.md](SECURITY.md).

**Keep the model native. Make the operating system yours.**
