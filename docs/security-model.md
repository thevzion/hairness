# Security model

Hairness separates access from authority. Mounts, adapters, providers, and
extensions grant no mutation rights. An executor receives effects only after a
stored checkpoint is matched to its Run, Assignment, current policy and locks,
then returns a validated receipt.

The WorkerResultGate validates the complete typed result and current run state
before staging or promoting any producer artifact. A rejected result leaves the
run resumable and cannot advance the durable artifact revision.

Hairness stores no credentials, auth artifacts, customer data, provider
transcripts, or model reasoning. Workspace-local state lives in `.overlay/`;
user trust and preferences live in `~/.hairness/`.

Local codebase mounts and extension links are path references, not authority.
Remote GitHub/npm targets use normalized URI identities without credentials,
queries or fragments. Hairness validates canonical paths and declared
identities before recording them. Unmount and unlink operations remove only
Hairness-owned symlinks and configuration, never their targets.
