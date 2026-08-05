# Coolisimplify

A desktop UI over the Coolify API for managing applications, services, and databases across projects, environments, and servers.

## Language

**Resource**:
An application, service, or database managed by Coolify. The generic term for anything rendered in the project tree.
_Avoid_: App, instance, workload

**Project**:
The top-level grouping in Coolify that contains environments. Rendered as a top-level node in the Sidebar.
_Avoid_: Team, workspace, folder

**Environment**:
A grouping inside a project that contains resources. A resource belongs to exactly one environment (via `environment_id`).
_Avoid_: Stage, namespace, group

**Server**:
The host where resources run. Its canonical display name is the one embedded in the resource's `destination.server.name`; top-level server ids are not reliable from the API.
_Avoid_: Host, node, machine

**Card**:
The per-resource row in the main area's resource list (`ResourceRow`) that shows status, type, name, domain, and server name.
_Avoid_: Tile, list item

**Sidebar**:
The left navigation tree listing Projects and their Environments, plus the All Resources root node. It contains containers only — Resources never appear in it, and empty containers are always shown.
_Avoid_: Explorer, nav tree, file tree

**All Resources**:
The Sidebar's root node; selecting it lists every Resource in the instance.
_Avoid_: Dashboard, home, overview

**Drawer**:
The right-side panel anchored to the selected Resource, with one tab per purpose (Details, Variables). There is only ever one Drawer; changing the selected Resource re-targets it, keeping the active tab.
_Avoid_: Modal, dialog, side panel, inspector

**Palette**:
The Cmd+K command palette that searches Projects, Environments, and Resources by name/domain/server and navigates to the chosen item.
_Avoid_: Quick switcher, spotlight, finder

**Status Roll-up**:
The worst state among a Sidebar node's descendant Resources, shown as a LED on the node (red: something down, amber: something transitioning, green: all running).
_Avoid_: Aggregate status, health indicator

**Batch Queue**:
The ordered set of selected Resources awaiting a batch action; selection order is execution order. It persists across Sidebar navigation and is shown as removable chips in the floating bar.
_Avoid_: Bulk selection, multi-select

**Details**:
The Drawer tab that shows the full metadata of a single Resource.
_Avoid_: Inspector, info panel, properties dialog

**Environment Variable (Env Var)**:
A key/value pair scoped to a Resource. It is *not* the same as an **Environment** (the project grouping) — the two terms are often conflated, but an Env Var attaches to a single Resource via `resourceable_type`/`resourceable_id`.
_Avoid_: Env, environment setting, configuration value

**Env Editor**:
The Variables tab of the **Drawer** that lists a Resource's Environment Variables and lets the user add, edit, and delete them. Distinct from **Details** (the metadata tab).
_Avoid_: Variable manager, env panel, secrets editor
