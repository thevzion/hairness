---
name: hairness-work-new-frame
description: Open one new frame in the active segment.
---

# hairness-work-new-frame

Invocation: `/hairness-work-new-frame`
Deterministic route: `hairness work new-frame --json`
Owner: `hairness/workframes`

Keep one active mission and segment. Frames remain bounded, inherit constraints, and never store transcripts. Use the deterministic `hairness work` routes to persist state. A closed segment is immutable and requires a typed SegmentDigest; resume it by opening a new segment linked with `continues`. Present only the smallest useful view requested by the active presentation modifier.

A command grants no authority. Respect active constraints and checkpoints. A worker receives only its capsule and returns one typed result to the declared fan-in.
