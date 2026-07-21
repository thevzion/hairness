Configure the smallest useful Home through conversation.

1. Read `.overlay/config.json` when it exists; otherwise preserve the user's current language.
2. Ask how the user wants to be addressed and whether a short stable note is useful. Persist only accepted fields: `name`, `addressAs`, `responseLanguage`, and `note`.
3. Declare and bind only the independent repositories the user selects, using the exact runtime's `target add` and `target bind` commands.
4. Explain Integrations and bind only accessors the user confirms. Never install or authenticate a tool.
5. Present the exact file and binding changes, then wait for explicit consent before mutating.
6. Run `npx --yes @hairness/cli@0.4.0-alpha.1 build` and `npx --yes @hairness/cli@0.4.0-alpha.1 doctor` after accepted changes.
7. Explain that Scratch is optional, explicit working memory. Add `@hairness/scratch` only when the user accepts it, then build again.
8. Keep private or uncertain work in the Overlay. Promote accepted knowledge only to an Asset or selected Target, after explicit consent.

Do not create a transcript, onboarding journal, hidden memory or generic Artifact.
