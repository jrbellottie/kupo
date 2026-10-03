# Kupo repository rules

Read and follow this file before working on each request in this repository.
The maintainer can edit this file to set ongoing Copilot project rules.

## Independent app and neutral wording

- Kupo is an independent companion app. Never imply that it is affiliated with,
  endorsed by, maintained by, or an official tool of Phoenix or any game server.
- This restriction concerns Phoenix the server, not the word "Phoenix" itself.
  In-game references, including Phoenix Feather and other canonical FFXI names,
  are allowed in the app and documentation.
- Do not use Phoenix the server as branding or descriptive wording in the app UI,
  notifications, help text, README, public documentation, release notes, or other
  user-facing copy. Use neutral wording such as "reference ruleset",
  "pinned source", or "source snapshot" instead.
- Apply this rule to new text and to existing text touched by a task. Check
  changed user-facing content for server-branded wording before finishing.
  Review mentions in context; do not use a blanket word ban or replacement.
- Do not rename canonical FFXI entities (for example, the item Phoenix Feather).
  An actual in-game name is not a claim of server affiliation.

## Source of truth and provenance

- Phoenix the server remains the source of truth for the mechanics and data it supplies
  to this project. Keep using the pinned snapshots, source overrides, and
  confirmed corrections. Neutral wording must not change calculations, drop
  tables, rates, or other behavior, or replace these with generic retail rules.
- Preserve accurate source URLs, repository identities, revision hashes,
  input paths, licenses, and required attribution. Do not falsify or erase
  provenance to satisfy the wording rule.
- Internal source filenames, identifiers, developer rules, compatibility
  commands, and machine-readable provenance may retain the source name where
  needed. Keep visible link labels and documented commands server-neutral.
- Do not describe source-specific behavior as universal across all servers.
  Keep relevant assumptions and live-server variation caveats.

## Maintainer additions

Add further project rules here as needed.
