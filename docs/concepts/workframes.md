# Workframes

Workframes is the temporal spine of the main session.

```mermaid
flowchart LR
    mission["Mission"] --> s1["Segment A · closed"]
    mission --> s2["Segment B · active"]
    s1 -- continues --> s2
    s2 --> f1["Frame · discuss"]
    s2 --> f2["Frame · execute"]
    s1 --> digest["SegmentDigest artifact"]
    s2 --> plan["WorkPlan artifact"]
```

- A mission preserves long-lived direction.
- A segment preserves one coherent context window.
- A frame applies one posture and boundary inside the active segment.
- An append-only event log preserves changes; `current.json` is reconstructible.
- A closed segment is immutable and requires a valid `segment-digest`.
- A resumed subject opens a new segment related by `continues`.

Frames are not artifacts. They reference sources, runs, and artifacts. Semantic boundaries create durable artifacts such as SegmentDigest, WorkPlan, decision records, specs, receipts, and handoffs.

```text
Workframes preserves the trajectory.
Artifacts preserve the meaning.
Sources prove current truth.
```
