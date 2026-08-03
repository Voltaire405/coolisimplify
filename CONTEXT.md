# Coolisimplify

A desktop UI over the Coolify API for managing applications, services, and databases across projects, environments, and servers.

## Language

**Resource**:
An application, service, or database managed by Coolify. The generic term for anything rendered in the project tree.
_Avoid_: App, instance, workload

**Project**:
The top-level grouping in Coolify that contains environments. Rendered as the dashboard's top-level cards.
_Avoid_: Team, workspace, folder

**Environment**:
A grouping inside a project that contains resources. A resource belongs to exactly one environment (via `environment_id`).
_Avoid_: Stage, namespace, group

**Server**:
The host where resources run. Its canonical display name is the one embedded in the resource's `destination.server.name`; top-level server ids are not reliable from the API.
_Avoid_: Host, node, machine

**Card**:
The per-resource row in the dashboard (`ResourceRow`) that shows status, type, name, domain, and server name.
_Avoid_: Tile, list item

**Details**:
The properties dialog (`ResourcePropertiesDialog`) that shows the full metadata of a single resource.
_Avoid_: Inspector, info panel
