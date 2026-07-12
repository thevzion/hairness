---
name: hairness-work-map
description: Map the active segment without introducing new scope.
---

# hairness-work-map

Invocation: `/hairness-work-map`
Deterministic route: `hairness work map --json`
Owner: `hairness/workframes`

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Keep one active mission and segment. Frames remain bounded, inherit constraints, and never store transcripts. Use the deterministic `hairness work` routes to persist state. A closed segment is immutable and requires a typed SegmentDigest; resume it by opening a new segment linked with `continues`. Present only the smallest useful view requested by the active presentation modifier.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
