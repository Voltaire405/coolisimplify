# Agent Instructions

## User Preferences

- Always check for and read `CLAUDE.local.md` if it exists.

## Behavioral Guideliness

Think about what you are about to do:

* **Before Implement:** Review all guideliness in `docs/guideliness/`.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in this repo, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Issues are triaged with the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Available Harness

- When you need a mock server to test against REST APIs from JSON or YAML specifications, refer to @PRISM.md
