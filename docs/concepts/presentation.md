# Presentation Controls

Presentation Controls changes how a result is rendered, never what the result means.

| View | Useful for | Poor fit |
| --- | --- | --- |
| `summary` | One compact conclusion | Detailed comparison |
| `diagram` | Flow, ownership, dependencies | Exact field lookup |
| `tree` | Hierarchy and file structure | Time sequence |
| `table` | Repeated fields and comparison | Causal flow |
| `timeline` | Events and state changes | Static hierarchy |
| `checklist` | Action and validation | Concept explanation |
| `matrix` | Trade-offs, risk, coverage | Linear procedure |
| `trace` | Evidence-to-conclusion chain | Broad overview |

Policies:

- `auto`: choose the smallest sufficient view and at most two complements.
- `compact`: optimize for fast resumption.
- `visual`: prefer relational views when they add information.
- `explicit`: use only the requested views.

The owning command must opt into `--present`. The core validates the modifier and the three-view budget; the main session selects views from available meaning and proof.
