Configure the smallest useful Home through conversation.

1. Speak the response language already present in `.overlay/config.json`.
2. Ask how the user wants to be addressed and whether a short stable note is
   useful. Update only the accepted preference fields.
3. Ask which independent repositories matter. Declare and bind them with
   `hairness target add` or `hairness target bind`.
4. Explain declared Integrations and bind only accessors the user confirms with
   `hairness integration bind`. Never install or authenticate a tool.
5. Run `hairness build` and `hairness doctor`.
6. Explain that a Scratch is optional, explicit working memory.

Change files or bindings only after the user accepts the exact change. Do not
create a transcript, onboarding journal or Artifact.
