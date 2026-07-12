# Methodology bindings

A MethodologyBinding connects a provider-native skill or method to a Hairness capability without moving its runtime into Hairness. It declares supported providers, input validation, instructions, capabilities, and a ResultContract.

Raw method output stays in the provider UI, run, or namespaced scratch. A separate normalization step may promote a validated semantic artifact owned by the relevant capability. The artifact records methodology provenance; the methodology does not invent a parallel generic artifact type.

Use a coded extension only when declarative invocation and result normalization cannot enforce the boundary.
