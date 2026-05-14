# Coolisimplify

A minimal Next.js dashboard for managing self-hosted [Coolify](https://coolify.io) instances. View projects, applications, services, and databases — and perform batch lifecycle actions (start, stop, restart, deploy) from a single interface.

## Features

- **Zero backend** — communicates with the Coolify REST API directly via a Next.js route handler
- **Batch operations** — select multiple resources and start/stop/restart/deploy them sequentially
- **Real-time status tracking** — pending pills stay visible until Coolify's containers actually transition
- **Dark mode** — built with next-themes
- **LocalStorage config** — server URL and API token stored client-side, no `.env` needed

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS 4
- [Turborepo](https://turbo.build/) + pnpm workspaces
- [Lucide](https://lucide.dev/) icons

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

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

## Project Structure

```
apps/
  web/                  # Next.js application
    app/                # App Router pages + API route handler
    components/         # UI components
    hooks/              # React hooks (Coolify client, data fetching, batch queue)
packages/
  ui/                   # Shared shadcn/ui components
  eslint-config/        # Shared ESLint config
  typescript-config/    # Shared tsconfig base
```

## Available Scripts

| Command            | Description              |
| ------------------ | ------------------------ |
| `pnpm dev`         | Start all apps in dev    |
| `pnpm build`       | Build all apps           |
| `pnpm lint`        | Lint all apps            |
| `pnpm format`      | Format with Prettier     |
| `pnpm typecheck`   | TypeScript type checking |

## Adding UI Components

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components are placed in `packages/ui/src/components` and shared across the monorepo.

## License

MIT
