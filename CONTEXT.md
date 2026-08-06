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

**Redeploy-needed**:
The state of an Application whose configured Docker image tag or git branch differs from what the running container was last started with. Derived client-side (not persisted): the marker is raised when the tag/branch is edited and cleared when a Redeploy succeeds, or when a Restart succeeds for a Docker-image Application (Coolify forces restart-only off for dockerimage apps, so a Restart pulls the new tag). A failed deploy leaves it standing. Shown as a chip on the Resource row.
_Avoid_: Restart-needed, needs-redeploy, pending-deploy

**Deployment**:
One build-and-release run of an Application, identified by the `deployment_uuid` that Deploy and Restart return. It is distinct from the **Resource**'s container: a failed Deployment leaves the previous container running and healthy, so the container says nothing about whether the Deployment worked.
_Avoid_: Build, release, job

**Verdict**:
The established outcome of a dispatched action — succeeded, failed, or still waiting. For an Application it comes from the **Deployment**'s status (`finished`/`failed`/`cancelled-by-user`); for Services and Databases, which have no Deployment, from the container status. Distinct from *queued*, which only means the API accepted the request. Timing out is not a verdict.
_Avoid_: Result, state, convergence

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

**ACCEPT**:
The exact uppercase token the user must type in a delete confirmation dialog to enable the destructive button. Used for both single-resource and batch deletes; typing the Resource's name is not required.
_Avoid_: Type the resource name, confirm-typed
