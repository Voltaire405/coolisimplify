# Master-detail redesign of the resource UI

Design agreed in a grilling session (2026-08-04). Replaces the accordion dashboard with a master-detail layout. See ADR-0004 for the structural decision; `CONTEXT.md` for the vocabulary (Sidebar, All Resources, Drawer, Palette, Status Roll-up, Batch Queue).

## Goal and criteria

Make it easy to visualize and manage Projects, Environments, and Resources. Criteria: user experience (ease of use), scalability (room to grow), visual clarity (cleanliness).

**Pain being solved:** the two-level accordion forces digging to see anything and becomes an endless column as projects grow (panorama problem). Editing via the modal is also cramped. Target scale: feels perfect at tens of resources, doesn't break at ~200 (single Coolify instance).

## Layout

```
┌────────────┬──────────────────────────────┬─────────────┐
│  Sidebar   │  Main area                   │  Drawer     │
│            │                              │  (when a    │
│ ⊙ All      │  [toolbar: search | filters] │  Resource   │
│ ▸ proj A   │                              │  is open)   │
│ ▾ proj B   │  ENVIRONMENT HEADER          │             │
│   · prod   │  [Card]                      │ [Details]   │
│   · dev    │  [Card]                      │ [Variables] │
│            │  [Card]                      │             │
│            │                              │             │
│            │  [floating batch bar: chips] │             │
└────────────┴──────────────────────────────┴─────────────┘
```

## Decisions

1. **Master-detail replaces the accordion** — Sidebar for navigation, main area for Resources, Drawer for one Resource's detail/editing. (ADR-0004)
2. **Sidebar is a two-level tree of containers only** (Project → Environment) plus an **All Resources** root node. Resources appear only in the main area — never duplicated in the tree.
3. **Node selection drives the main area**: an Environment shows its Resources; a Project shows all its Resources grouped under Environment headers; All Resources shows everything.
4. **Cards stay** (`ResourceRow` interactions are kept: LED, inline rename, guarded actions, batch checkbox), but **densified** to one primary line (name + badges; domain/server as truncated secondary text) targeting ~15–20 rows per screen.
5. **Toolbar above the list**: contextual search input (filters visible Cards by name, domain, server) + quick filters by status and type. On All Resources this is de facto global search. A "problems" quick filter surfaces degraded/stopped Resources.
6. **Drawer replaces the properties modal**, docked right, one per selected Resource, with purpose tabs: **Details** (metadata, from `ResourcePropertiesDialog`) and **Variables** (the Env Editor, full height). Entry points deep-link to a tab (type badge / domain line → Details; a Variables affordance → Variables). Switching Resources re-targets the Drawer, keeping the active tab. Tabs leave room for future purposes (deployments).

    **Amended:** logs were expected to become a third tab here, but shipped as a wide modal instead (`LogsDialog`), opened from a `Terminal` button on the Card and a `Logs` entry in the `⋯` menu. The Drawer is a ~380px column and monospaced container output reads badly in it. The modal keeps `lines`/`show_timestamps` in page state so they carry between openings, but — unlike the Drawer — it is deliberately not in the URL: a log tail is a moment, not a bookmarkable view.
7. **Palette (Cmd+K)** from day one: fuzzy search across Projects, Environments, Resources; choosing an item navigates the Sidebar, highlights the Card, and can open the Drawer. Can copy a deep link.
8. **State persistence**: selected node + Drawer (resource, tab) in URL query params (`?node=…&drawer=…&tab=…`); tree expansion in localStorage. Back/forward and bookmarks work. No App Router route restructuring.
9. **Batch Queue persists across navigation**; the floating bar shows removable, ordered chips with Resource names (selection order = execution order), so out-of-view members are always visible before executing. `ACCEPT` confirmation for batch delete stays.
10. **Empty Environments and Projects are shown** in the Sidebar (badge "0", empty state in main area). The tree is a faithful map; reverses the current hide-empty filter.
11. **Status Roll-up on tree nodes**: each node shows a LED for the worst descendant state (aggregate `classifyResourceState` per Environment → Project → root). The collapsed Sidebar acts as a passive health board. Counters remain as discreet badges.
12. **Sort stays fixed** (type → alphabetical): spatial anchoring beats configurable sort at this scale. No "problems first" reordering — rows must not move as states change; detection is covered by Roll-up + the problems filter.
13. **Data layer unchanged** (ADR-0002): global fetch + client-side matching by `environment_id`. Revisit only at hundreds of projects.

## Rejected along the way

- Three-level tree, table layout, card grid (see ADR-0004).
- A fixed "Attention" section in the Sidebar (duplicates Resources; the problems filter covers it).
- Sidebar tree search and configurable sort (noise at this scale).
- Clearing the Batch Queue on navigation (kills cross-project batches).

## Phases

Each phase is one functional PR; all agreed scope lands, this is only ordering.

- **F1 — Master-detail skeleton**: Sidebar (tree, All Resources root, empty containers visible, counters), main area with grouped Cards, URL/localStorage state. Details remains a modal for now. Replaces `ProjectCard`/`EnvironmentGroup` accordion.
- **F2 — Drawer**: migrate `ResourcePropertiesDialog` + Env Editor into the tabbed Drawer; deep-linked entry points; `tab` in URL.
- **F3 — Search**: toolbar (contextual search + status/type/problems filters) and the Cmd+K Palette with navigate-to-result.
- **F4 — Batch chips + Status Roll-up**: chip bar for the Batch Queue; LED roll-up on Sidebar nodes.
