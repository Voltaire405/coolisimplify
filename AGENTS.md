# Agent Instructions

## User Preferences

- Always find @CLAUDE.local.md at the begining to read user preferences.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in this repo, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Issues are triaged with the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Available Harness

### Prism

Prims allows you to run a mock server for fast testing. Run example:

```
prism mock coolify-openapi-v4.x.yaml --port 13000 --cors
```

**Important:** Always stop the mock server after finishing tests.

**Note:** `prism mock -h` to see another options.
