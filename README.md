# Coolisimplify

A master-detail dashboard for managing self-hosted [Coolify](https://coolify.io) instances: a Sidebar tree of Projects and Environments, a main area of Resource Cards, and a Drawer with per-Resource Details and Environment Variable editing — plus a Cmd+K palette and batch lifecycle actions across everything the instance exposes.

See `CONTEXT.md` for the domain vocabulary (Resource, Project, Environment, Server, Drawer, Palette, Batch Queue, …) used throughout the code and this document.

## Features

- **Master-detail navigation** — Sidebar (All Resources root → Project → Environment, containers only) drives a main-area list of Resource Cards; selecting a Card opens the Drawer. Selection and Drawer state live in the URL, tree expansion in `localStorage` — back/forward and deep links work.
- **Drawer** — one panel per selected Resource with Details and Variables tabs; switching Resources re-targets it without closing it.
- **Environment Variable editor** — add, edit, and delete a Resource's env vars with per-row PATCH requests (not a bulk replace), validated against the Coolify OpenAPI schema.
- **Cmd+K Palette** — fuzzy-search Projects, Environments, and Resources by name, domain, or server, and jump straight to them.
- **Toolbar search + filters** and a right-click **context menu** on Cards for single-resource actions.
- **Batch Queue** — select resources in click order (order = execution order); the queue persists across Sidebar navigation and renders as removable chips in a floating bar. Start/stop/restart/deploy run sequentially; delete requires reviewing destructive options and typing `ACCEPT`.
- **Status Roll-up LEDs** — Sidebar nodes show the worst state among their descendant Resources (red/amber/green), so you can spot trouble without expanding the tree.
- **Clone** — duplicate an application, service, or database by constructing an explicit per-endpoint allowlist payload (Coolify's create endpoints reject any field outside their own allowlist — see `TROUBLESHOOTING.md`), instead of copying the GET detail.
- **Real-time status tracking** — pending pills stay visible until Coolify's containers actually transition.
- **Dark mode** — built with `next-themes`.
- **Zero backend** — the only server code is a thin Next.js route handler (`apps/web/app/api/coolify/[...path]/route.ts`) that forwards requests to your Coolify instance using the URL/token sent in request headers; no database, no server-side session.
- **LocalStorage config** — server URL and API token are entered once in Settings and stored client-side, no `.env` needed.
- **Coolify API v4.x contract** — `coolify-openapi-v4.x.yaml` is a synced copy of the [official OpenAPI spec](https://github.com/coollabsio/coolify/blob/v4.x/openapi.yaml) and is the source of truth used by the verification scripts below.

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router, Turbopack dev server)
- [React 19](https://react.dev/)
- [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS 4
- [Turborepo](https://turbo.build/) + pnpm workspaces
- [Lucide](https://lucide.dev/) icons

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- A reachable Coolify v4.x instance and API token (or the [Prism](https://stoplight.io/open-source/prism) mock server below, for UI-only work)

### Installation

```bash
git clone https://github.com/Voltaire405/coolisimplify.git
cd coolisimplify
pnpm install
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click the config button, and enter your Coolify server URL and API token.

### Build

```bash
pnpm build
pnpm start
```

### Developing without a live Coolify instance

Run the bundled OpenAPI spec through [Prism](https://stoplight.io/open-source/prism) to mock the API, then point Settings at `http://localhost:13000` with any token:

```bash
prism mock coolify-openapi-v4.x.yaml --port 13000 --cors
```

Stop the mock server when you're done testing.

## Project Structure

```
apps/
  web/
    app/                    # App Router: single dashboard page + the Coolify proxy route handler
    components/             # Sidebar, Drawer, Cards, Palette, Batch Queue, Clone/Confirm dialogs, ...
    hooks/                  # use-coolify (data + mutations), use-settings (localStorage config)
    lib/                    # coolify-client, clone (allowlist payload builder), envs, tree, resource-state, types
    test/                   # Test helpers: fake Coolify instance, OpenAPI schema extractor
packages/
  ui/                        # Shared shadcn/ui components
  eslint-config/             # Shared ESLint config
  typescript-config/         # Shared tsconfig base
docs/
  adr/                       # Architecture decision records
  agents/                    # Issue tracker, triage labels, domain-doc conventions
  design/                    # Design docs (e.g. the master-detail redesign)
coolify-openapi-v4.x.yaml    # Synced copy of the Coolify v4.x OpenAPI spec — source of truth for payload validation
CONTEXT.md                   # Domain vocabulary used across the codebase
TROUBLESHOOTING.md           # Known Coolify API quirks and how this codebase works around them
```

## Available Scripts

| Command                    | Description                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`                 | Start all apps in dev                                                            |
| `pnpm build`                | Build all apps                                                                   |
| `pnpm lint`                 | Lint all apps                                                                    |
| `pnpm format`               | Format with Prettier                                                             |
| `pnpm typecheck`            | TypeScript type checking                                                         |
| `pnpm test`                 | Run the Vitest suite                                                             |

Tests live beside the code they cover (`apps/web/lib/*.test.ts`, `apps/web/hooks/*.test.ts`) and need no live instance: HTTP is answered by a fake Coolify on an ephemeral port (`apps/web/test/fake-coolify.ts`), and clone/env/log payloads are validated against `coolify-openapi-v4.x.yaml` plus documented controller-only rules. The whole suite runs in a couple of seconds. See `TROUBLESHOOTING.md` for the failure modes it exists to catch, and `docs/adr/0007-vitest-replaces-the-check-scripts.md` for why it is shaped this way.

Run a single file with `pnpm --filter web test lib/deploy-verdict.test.ts`, or watch with `pnpm --filter web test:watch`.

## Documentation

- `CONTEXT.md` — the project's domain vocabulary (what "Resource", "Drawer", "Batch Queue", etc. mean here)
- `docs/adr/` — architecture decision records
- `docs/design/` — longer-form design docs
- `TROUBLESHOOTING.md` — Coolify API validation quirks (allowlists, base64 fields, GET/CREATE mismatches) and how the code handles them
- `docs/agents/` — conventions for agent-driven work in this repo (issue tracking, triage labels, domain docs)

## Adding UI Components

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components are placed in `packages/ui/src/components` and shared across the monorepo.

## License

MIT
