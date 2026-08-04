# 0004 Master-detail navigation replaces the accordion dashboard

The dashboard was a two-level accordion (`ProjectCard` → `EnvironmentGroup` → `ResourceRow`) in a single scrolling column: everything collapsed by default, no search, no persistent expansion state. Seeing anything required digging, and the layout degraded into an endless column as projects grew. We decided to replace it with a master-detail layout: a left **Sidebar** tree of containers only (All Resources root → Project → Environment), a main area listing the selected node's Resources as Cards, and a right **Drawer** with purpose tabs (Details, Variables) replacing the properties modal. Full rationale and the phased plan live in `docs/design/master-detail-redesign.md`.

## Considered Options

- **Keep the accordion, add search/filters** — rejected: search finds things, but the panorama problem (dig to see anything) remains.
- **Three-level tree with Resources as leaves** — rejected: duplicates Resources in two places (or demotes the main area to detail-only) and saturates the Sidebar at ~200 resources.
- **Table layout for the main area** — rejected: rebuilds working row interactions (inline rename, batch checkboxes, guarded actions) for marginal density gains.

## Consequences

- Selected node and Drawer state move to the URL (query params); tree expansion moves to localStorage. Back/forward and deep links become meaningful.
- Empty Environments and Projects become visible in the Sidebar — the tree must be a faithful map of the Coolify instance (this reverses the current "hide empty groups" behavior).
- ADR-0002 still holds: resources are fetched globally and matched client-side; the Sidebar changes rendering and navigation only, not the data layer. Scoped fetching is only worth revisiting at hundreds of projects.
