# Security model

Hairness separates access from authority. Mounts, adapters, providers, and
extensions grant no mutation rights. An executor receives effects for explicit
targets through a checkpointed grant and returns a validated receipt.

The WorkerResultGate validates the complete typed result and current run state
before staging or promoting any producer artifact. A rejected result leaves the
run resumable and cannot advance the durable artifact revision.

Hairness stores no credentials, auth artifacts, customer data, provider
transcripts, or model reasoning. Workspace-local state lives in `.overlay/`;
user trust and preferences live in `~/.hairness/`.

Local codebase mounts and extension links are path references, not authority. Hairness validates their canonical paths and declared identities before recording them. Unmount and unlink operations remove only Hairness-owned symlinks and configuration, never their targets.
