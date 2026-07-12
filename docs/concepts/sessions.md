# Sessions

Hairness opens or resumes a stable local `HairnessSession` even when the provider exposes no session ID. Codex and Claude references attach best-effort later; `provider-session-unbound` is a limit, not a blocker.

After workspace opt-in, Hairness may read an allowlisted transcript inbox as a volatile source and create a semantic `session-handoff` artifact.

Hairness deletes processed inbox events and never promotes transcripts or model reasoning. Handoffs preserve decisions, evidence, limits, and next routes.
