# Semantic results

ResultContract combines output schema and disposition:

| Disposition | Boundary |
| --- | --- |
| `response` | Provider UI only |
| `run-only` | Canonical run result |
| `scratch` | Disposable owner/run namespace |
| `artifact` | Validated, revisioned semantic meaning |
| `effect` | Exact authority, target, lock, and receipt |

The rule is deliberately conservative: persist meaning at semantic boundaries, not every model output.

Operations may expose several named results. Provider intent commands choose
one through `draft.result`. Their promotion is `none`, `artifact`, or `effect`;
promotion never grants authority.

`make-recap` returns a typed `SegmentDigest` and `make-plan` returns a typed
`WorkPlan`, both with `promotableTo`. `save-*` selects the latest compatible
result in the current frame/segment and promotes its exact payload. The source
Invocation is the artifact revision, so repeating the same promotion is
idempotent. No compatible or unambiguous candidate means one explicit gap, not
a new synthesis.
