# Hairness v0.3 specification

Status: experimental alpha
Package: `@hairness/cli@0.3.0-alpha.0`

**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## 1. Product boundary

Hairness is a lightweight, provider-agnostic harness for agentic assets. The npm
runtime MUST own deterministic composition, validation, local bindings,
checkpoints, receipts, and provider compilation. Providers MUST retain their
models, UI, threads, tools, workers, and scheduling.

A Home MUST own agentic assets and MUST NOT own a Target repository. A Target
MUST remain an independent repository identity. Its local binding MUST be an
ignored `targets/<id>` symbolic link and MUST NOT be duplicated in tracked
documents or Runtime registries. Integration, installation, registration, or file presence MUST NOT
grant effect authority.

## 2. Document APIs

Public documents MUST declare `apiVersion` and `kind`. There is no global schema
or protocol version.

| Document | API |
| --- | --- |
| Home and HomeLock | `hairness.dev/home/v1alpha1` |
| Distribution | `hairness.dev/distribution/v1alpha1` |
| Extension | `hairness.dev/extension/v1alpha1` |
| Scratch | `hairness.dev/scratch/v1alpha1` |
| Artifact | `hairness.dev/artifact/v1alpha1` |
| Checkpoint | `hairness.dev/checkpoint/v1alpha1` |
| Receipt | `hairness.dev/receipt/v1alpha1` |

Packages and extensions MUST use SemVer.

## 3. Home and Distribution

A generated Home MUST contain a pinned npm dependency, `hairness.json`,
`hairness.lock.json`, installed extension source, small managed regions in
`AGENTS.md` and `CLAUDE.md`, provider skill sentinel files, and an Overlay.

`hairness.json` MUST select providers, extension IDs, Target identities,
namespaced extension config, and Overlay policy. `hairness.lock.json` MUST record Distribution provenance and
each extension source kind, requested ref, immutable Git commit when applicable,
source digest, and installed base digest. Neither file may contain local Target
paths or generated provider output paths.

The personal profile MUST be the unwrapped `.overlay/profile.json` object with
only optional `name`, required `language`, and optional stable `note`. Values
MUST be bounded and sanitized before projection. Every non-empty field MUST
appear in the managed provider prologue. Targets, maps, active Scratch and live
health MUST NOT appear there. A profile change MUST make provider build checks
stale until rebuilt.

A Distribution MUST be bootstrap-only. It MAY contain extensions, expected
Targets, initial namespaced config, defaults, policies, onboarding contributions,
documentation, and tests. It MUST NOT
contain a kernel, CLI, runtime, Overlay, Targets, provider output, or material
graph. After creation it has no synchronization role.

## 4. Extension contract

An Extension manifest MUST contain:

```text
apiVersion
kind: Extension
metadata: id, version, summary
spec: provides, requires, recipes, adapters, schemas, gates, onboarding, tests
```

`spec.configSchema` MAY point to a JSON Schema owned by the extension. Home
config keys MUST belong to active extensions and present values MUST validate
against their owner's schema. Missing or invalid config MAY make doctor partial
and MUST block the affected adapter, but MUST NOT prevent onboarding recipes
from compiling. A chat-only extension without config or package metadata MUST
remain valid. Home extension packages MUST share one root npm workspace and lock;
install before explicit trust MUST use `--ignore-scripts`.

`provides` and `requires` MUST reference capability IDs. One active composition
MUST NOT contain two providers for the same capability, two recipes with the
same command ID, or a missing requirement.

A Recipe MUST be provider-neutral Markdown. It MUST converse directly and MUST
NOT call the CLI merely to produce chat. An Adapter MUST declare `observe`,
`derive`, or `effect`. Observe and derive adapters MUST NOT request effects. An
effect adapter MUST export separate prepare and apply boundaries.

Onboarding contributions MUST be declarative. Extension code MUST NOT execute
during source inspection. Physical presence MUST NOT activate an extension;
only the Home selection does.

Git extension refs MUST resolve to immutable commits. Update MAY replace an
installed extension mechanically only when its current digest equals its
installed base digest. Divergence MUST stop for explicit adoption or human
merge. Hairness MUST NOT provide a generic three-way merge or migration engine.

## 5. Provider command surface

Standard MUST compile exactly ten human commands: `hairness`,
`hairness-onboarding`, `hairness-scratch`, `hairness-discuss`, `hairness-map`,
`hairness-ideate`, `hairness-propose`, `hairness-recap`, `hairness-plan`, and
`hairness-ship`.

Codex MUST project `$hairness-…`; Claude MUST project `/hairness-…`. A rebuild
MUST produce equivalent semantics. Generated outputs MUST be listed exactly in
Runtime build state and only those exact paths MAY be locally excluded from Git.
Hairness MUST NOT own, ignore, or clear a complete provider directory.

Chat recipes MUST create no operation state or receipt. Recap, map, and plan MUST
render in chat first and MUST persist only the exact accepted payload after an
explicit save request.

## 6. Overlay, Scratch, and Artifact

A provider session MUST begin ephemeral. Without an active Scratch, Hairness
MUST write no work memory. Once attached, notes MAY change only at semantic
boundaries: accepted decisions, changed constraints, handoffs, changed next
steps, park, and close. Transcripts and reasoning traces MUST NOT be stored.

Overlay Git MAY be enabled as a nested local repository. Boundary snapshots
SHOULD be the default; manual snapshots MUST remain available. Hairness MUST NOT
configure a remote or push. Snapshots MUST refuse credential-like paths,
escaping symbolic links, and oversized accidental files.

An Artifact MUST contain one envelope and exactly one canonical payload.
Human-facing payloads SHOULD use Markdown. Machine-consumed payloads MUST use
owner-validated JSON. Git supplies history; internal revision graphs, generated
Markdown mirrors, mandatory relations, labels, and signals MUST NOT exist.
Receipts are separate immutable core records.

## 7. Runtime

Machine state MUST live below `~/.hairness/` in preferences, trust, archives,
and `runtime/<home-id>/`. Runtime MAY contain provider builds, Source bindings,
adaptive checkouts, checkpoints, locks, caches, temporary staging, and logs.
Runtime state MUST NOT be committed to the Home or Overlay.

Source configuration MUST be extension-owned. v0.3 accessors are `cli`,
`provider`, and explicitly acknowledged `none`. Hairness MUST NOT install or
authenticate a Source. Runtime MAY record only Source identity, accessor kind,
command or provider identity, optional version, and validation time. It MUST NOT
record secrets, fetched Source results, or redundant Target paths.

Legacy Overlays MAY be copied opaquely into archives without schema parsing.
Only user-selected human content MAY be imported through the generic Scratch
importer.

## 8. Effects and receipts

`operation run` MUST accept only observe and derive adapters. `operation prepare`
MUST create a Checkpoint bound to exact inputs, Target identity and state,
evidence, and policy. `operation apply` MUST recompute that state and refuse any
relevant change.

An effect that succeeds, partially succeeds, or has an unknown outcome MUST
produce an immutable Receipt. Partial and unknown outcomes MUST stop replay. Extension
installation and Target registration MUST explicitly grant no operational
authority.

## 9. Onboarding and creation

The create wizard MUST use the platform readline API and ask, in order: language,
setup or explicit Distribution, providers, current repository/workspace/skip,
and local Overlay Git. Standard MUST be recommended. Home Git and an initial local commit are mandatory. Overlay Git is
optional and, when selected, receives its own initial local commit.

Creation MUST occur in Runtime staging. Install, build, and doctor MUST pass
before an atomic move to the destination. Failure MUST leave no partial
destination. Creation MUST NOT configure a remote, push, tag, or publication.

Agent onboarding MUST use the selected language from its first reply, save a
resumable draft after every answer, capture optional profile fields, situation
and immediate objective, discover Target candidates without choosing between
clones, select Source accessors, ask declarative extension questions,
progressively explain Home, Target, Scratch, persistence and checkpoints, and
finish with a short command tour. One exact checkpoint MUST guard atomic config,
binding, rebuild and doctor application. Completion describes configuration;
later live health failures MUST make doctor partial without reopening onboarding.

`hairness doctor [--json]` MUST be the single computed macro view. It MUST expose
Home, extensions, providers, profile, onboarding configuration, build, Targets,
Sources, saved Target-map freshness, active session Scratch, limits and repair
routes. No SessionOpening document or `opening` command may exist.

Target discovery MUST be recursive and read-only, recognize Git directories and
worktree files, stop descending after finding a repository below the explicit
workspace root, ignore symlinked
directories and known dependency caches, continue past unreadable directories,
inspect all remotes, normalize SSH/SCP-like/HTTPS identities, and return every
matching clone without implicit selection. Target mutation MUST use exact
checkpoints and refuse remote mismatch or dirty/occupied removal.

## 10. Delivery

Delivery MUST create no durable state until the human accepts a typed
DeliveryBrief. The brief MUST contain outcome, acceptance criteria, scope,
non-goals, Target, base, release impact, and required checks.

Checkout policy MUST be adaptive: reuse a clean, available, compatible checkout;
isolate dirty, occupied, incompatible, or explicitly parallel work in an internal
Git worktree. Scratch remains the work identity. Runtime owns checkout paths and
locks. No public worktree controller, pool, lease, takeover, or hook may exist.

Named stages are `after-implementation`, `before-publish-pr`, `before-merge`, and
`after-merge`. Extensions MAY contribute gates. Scope drift MUST block PR
publication. PR, merge, tag, release, and package publication remain separate
effects. Cleanup MUST refuse dirty or externally used worktrees and MUST NOT
force deletion implicitly.

## 11. Compatibility

v0.3 MUST NOT provide v0.2 command aliases, schema readers, runtime bridges,
Home upgrades, Overlay conversion, migration descriptors, or a legacy
documentation tree. The supported upgrade is to create a new Home. Published
v0.2 packages remain available for users who pin them.
