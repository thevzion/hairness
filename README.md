<div align="center">

# hairness

### Own the place where your agents work.

**A provider can host the agent. It shouldn’t own the Home.**

[![npm next](https://img.shields.io/npm/v/%40hairness%2Fcli/next?label=npm%20next)](https://www.npmjs.com/package/@hairness/cli)
[![CI](https://github.com/thevzion/hairness/actions/workflows/ci.yml/badge.svg)](https://github.com/thevzion/hairness/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-d8996a.svg)](LICENSE)

<sub>0.4 is an alpha. Use a dedicated Git repository and review every Adapter before approving it.</sub>

</div>

![Ness moves from an improvised workspace into a Home, extends it, then joins a city of shared agentic assets.](https://raw.githubusercontent.com/thevzion/hairness/main/docs/assets/ness-journey.png)

## Ness needed a Home. So we built one.

Ness could work in Codex today and Claude tomorrow. Each provider offered a
project folder, instructions, skills and memory in its own shape. Switching
providers meant moving in again. Sharing the setup meant explaining which files
belonged where.

Hairness gives Ness one place to live:

- a Git repository that owns the agentic assets;
- provider projections that work after a clone;
- local rooms for private memory and repository bindings;
- Assets you can read, edit and keep.

The Kernel stays small. Your Home carries the value.

Hairness handles the logistics behind that Home: getting the right source-owned
agentic material into the right place, preserving who owns it, and projecting
it for whichever provider hosts the agent.

## Give your agent a Home

Create it once:

```bash
npx --yes @hairness/cli@0.4.0-alpha.0 create ness-home
```

Open an agent there:

```bash
codex -C ness-home
# or
cd ness-home && claude
```

Then invoke the onboarding Skill:

```text
$hairness-onboarding
# Claude Code: /hairness-onboarding
```

The conversation stays human:

```text
Ness: I want this Home in French and I work on ~/Projects/my-game.

Agent: I can save French as your response language, declare my-game as an
independent Target, bind this checkout, then rebuild and run doctor.
I will change .overlay/config.json and hairness.json, and create a local
targets/my-game binding. Shall I proceed?

Ness: Yes. Add Scratch too.
```

<details>
<summary><strong>What did the agent do?</strong></summary>

The onboarding Skill asked for consent, edited the accepted local preferences,
then invoked the exact runtime owned by the Home:

```bash
npx --yes @hairness/cli@0.4.0-alpha.0 target add ~/Projects/my-game
npx --yes @hairness/cli@0.4.0-alpha.0 add @hairness/scratch -y
npx --yes @hairness/cli@0.4.0-alpha.0 build
npx --yes @hairness/cli@0.4.0-alpha.0 doctor
```

Hairness did not install a background service, authenticate another tool or
execute code during `add`.

</details>

## One tree, clear ownership

```text
ness-home/
├── hairness.json                         # Home identity and composition
├── assets/
│   └── hairness/
│       ├── onboarding/
│       │   ├── hairness.json             # source + installation provenance
│       │   ├── instructions/home.md
│       │   └── skills/...
│       └── scratch/                       # present only after consent
├── AGENTS.md                              # tracked Codex projection
├── CLAUDE.md                              # tracked Claude projection
├── .agents/skills/...                     # tracked Codex Skills
├── .claude/skills/...                     # tracked Claude Skills
├── .codex/hooks.json                      # exact runtime hook
├── .claude/settings.json                  # exact runtime hook
├── .gitignore
│
├── .overlay/                              # local to this Home instance
│   ├── config.json                        # preferences and Integration bindings
│   └── scratches/...                      # explicit working memory
├── targets/                               # local links to independent Git repos
└── .hairness/build.json                   # local output ownership and digests
```

Git tracks the Home definition, installed Asset sources and provider
projections. A clone can start an agent without a build step. Git ignores the
Overlay, Target bindings and Kernel build state in a new Home.

Your existing Home may track its Overlay. Hairness keeps that decision yours.

## Targets keep work separate

A Home holds the context. A Target holds the work.

```bash
npx --yes @hairness/cli@0.4.0-alpha.0 target add ~/Projects/payments-api
```

Hairness records the Target’s normalized Git remote in `hairness.json` and adds
a local symlink under `targets/`. Your Home can now orient the agent with the
remote, binding, branch and clean or dirty state. The Target remains its own Git
repository.

One personal Home can connect several projects. A team Home can connect the
repositories that implement one business domain.

## Assets add rooms you own

An Asset is a folder with one manifest and source files:

```text
assets/company/security/
├── hairness.json
├── instructions/policy.md
├── skills/security-review/SKILL.md
└── knowledge/threat-model.md
```

```json
{
  "$schema": "https://hairness.dev/schema/asset.json",
  "name": "company/security",
  "version": "1.2.0",
  "description": "Security policy, knowledge and review capability.",
  "files": [
    {
      "path": "skills/security-review/SKILL.md",
      "type": "hairness:skill",
      "id": "security-review",
      "description": "Review a change against company security policy."
    },
    {
      "path": "knowledge/threat-model.md",
      "type": "hairness:file"
    }
  ]
}
```

Install from the source you trust:

```bash
hairness add @hairness/scratch
hairness add company/agentic-assets/assets/security#v1.2.0
hairness add company/agentic-assets/assets/security#8d31f3c7f05f4c6fd4a15ad31f4d23ff9d472312
hairness add https://assets.example.com/security/hairness.json
hairness add ./local/security/hairness.json
```

Hairness copies the files into your Home. It adds source, requested reference,
resolved commit and base digests to the same `hairness.json`. No separate lock or
receipt hides the relationship.

An installed Asset is also a valid Git source for another Home. Hairness ignores
the previous installation provenance and records the new source and digests for
the receiving Home.

### Change the source

The installed files belong to you:

```bash
$EDITOR assets/company/security/skills/security-review/SKILL.md
git diff
hairness status company/security
```

```text
company/security: customized
```

Hairness compares your file with its installation digest without contacting the
network. A later sync stops at your edit:

```bash
hairness sync company/security
```

```text
sync_customized: company/security has local changes; inspect hairness diff or pass --overwrite.
```

You can keep the edit, commit it, inspect `hairness diff`, or choose
`--overwrite`. Hairness does not merge behind your back.

### Build for the provider

Skills stay provider-neutral inside the Asset. `hairness build` projects
them into Codex and Claude conventions. A provider command remains a projection
of a Skill, so the Asset does not carry two versions of the same capability.

Instructions shape behavior. Skills give the agent a callable capability.
Files carry knowledge, templates, examples or other agentic material.

## Knowledge stays with its owner

A Home does not collect every document under one root `docs/` directory.
Knowledge stays close to what owns it:

| Material | Owner | Canonical place |
|---|---|---|
| private, incomplete or uncertain work | this Home instance | `.overlay/` |
| knowledge required by a reusable capability or domain | an Asset | `assets/<namespace>/<name>/knowledge/` |
| product or repository knowledge | its Target | the Target's own convention, often `docs/` |
| documentation about the Home itself | the Home | `README.md`, and `docs/` only when needed |

Promotion from the Overlay to an Asset or Target is explicit. Provider
projections consume this material but never become its canonical source.

## Homes at different scales

You can start with one room and keep the same grammar as your needs grow.

| Home | Useful agentic assets | Typical Targets |
|---|---|---|
| Personal game development | engine conventions, art pipeline, playtest Scratch | game, tools, website |
| Personal agentic tools | evaluation Skills, protocol notes, release routines | HACP, decks, adapters |
| Engineering team | architecture, delivery policy, incident procedures | services and infrastructure |
| Operations team | client vocabulary, checklists, reporting templates | knowledge repositories |
| Company | shared policies, brand voice, domain map | cross-team references |

An individual can clone a team Home, keep `.overlay/` local, and add a personal
Asset. A company can publish Assets from ordinary Git repositories.
Each team composes its own Home from the assets it needs.

One Home is a house for an agent. Teams connect houses through shared
Assets. Over time, the organization builds a city: a source-owned body of
instructions, capabilities, knowledge and explicit memory that helps agents
understand the business. That city is agentic capital because the organization
can inspect it, improve it and carry it to another provider.

## The Kernel

`@hairness/cli` contains the whole Kernel:

```text
create · init
add · status · diff · sync · remove
build · doctor · prologue
target ... · integration ...
```

The CLI validates paths and schemas, applies file changes as transactions,
tracks output ownership and projects assets. `add` and `sync` copy data only.
An Asset may contain an Adapter, but Hairness runs it during `build` only
after named approval:

```bash
hairness build --allow-adapter company-importer
```

Hairness stages Adapter output, rejects undeclared paths and rolls back on a
collision.

## Scope of the alpha

A provider Project may cover your needs when you use one provider, keep a small
context and do not need source ownership. Hairness serves Homes that need to
move, compose or grow across people and runtimes.

The alpha has no marketplace, registry service, dependency solver, daemon,
automatic update or automatic merge. Git provides history and restoration.
Hairness arranges the files and rebuilds the provider views.

Read the [technical reference](docs/reference.md), [security policy](SECURITY.md)
and [contribution guide](CONTRIBUTING.md) before using Hairness for shared or
sensitive work.

## License

MIT
