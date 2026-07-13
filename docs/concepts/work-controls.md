# Work Controls

Work Controls preserve collaboration trajectory without preserving conversation.

```mermaid
flowchart LR
  mission["Mission"] --> closed["Closed segment"]
  mission --> active["Active segment"]
  closed -- continues --> active
  active --> frame["Bounded frame"]
  closed --> digest["SegmentDigest"]
  active --> plan["WorkPlan"]
```

- A mission keeps long-lived direction.
- A segment represents one coherent unit of work; only one is active.
- A frame narrows posture and boundary inside the active segment.
- Append-only events preserve state transitions; `current.json` is reconstructible.
- Closing requires a valid SegmentDigest and makes the segment immutable.
- Resuming a closed subject creates a related segment rather than rewriting history.

Frames are not artifacts. They reference sources, runs, decisions, and artifacts. Recap and plan create typed semantic boundaries. Act and execute still require effective constraints and explicit authority.

Provider-facing work controls are chat-first:

- `hairness-cmd-make-recap` and `hairness-cmd-make-plan` return typed response dashboards.
- `hairness-cmd-save-recap` and `hairness-cmd-save-plan` promote the exact compatible result.
- `hairness-cmd-show-work` includes active work and open Invocations.
- `hairness-cmd-show-trace` links the root Invocation, child Runs and fan-in.
- `--auto` advances invocation progress but never changes promotion.

`WorkPlan` is the durable Plan Segment. It carries execution boundary, original frame, frames considered, coherence, already-done evidence, goal, scope and non-goals, target shape, ownership changes, compatibility, decision batch, steps, validation, risks, checkpoints and open questions.

The old `reshape-system` flavor is represented as target-shape controls:
scope, old owner, target owner, legacy kept/deleted, compatibility, proof and
checkpoint. `hairness-cmd-plan-system-shape` produces that shape in chat;
`hairness-cmd-save-plan` promotes it after acceptance.

```text
Work Controls preserve trajectory.
Artifacts preserve meaning.
Sources prove current truth.
```
