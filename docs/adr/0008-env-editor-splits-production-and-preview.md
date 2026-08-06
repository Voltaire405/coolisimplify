# 0008 The Env Editor splits Production and Preview into two sections

The Variables tab lists a Resource's environment variables as one flat list. Coolify has always merged two lists into it — `environment_variables` (`is_preview=false`) and `environment_variables_preview` (`is_preview=true`) — and every application can therefore hold two records with the same key: the Production Variable and the Preview Variable. A flat list hides that identity: the row's `is_preview` flag is the only thing telling them apart, and editing one "overrides" the other only if you notice the flag. The Env Editor now renders two stacked sections, **Production** and **Preview**, so the two records are visible as what they are.

## The section owns the flag, not the form

Creating a variable used to offer a `Preview` checkbox in the form. The checkbox is gone: the section you click "Add variable" in fixes `is_preview`. The checkbox was the wrong tool for the identity — the two records are not two modes of one record, they are separate records that happen to share a key (CONTEXT.md: Preview Variable), and a checkbox suggests you are choosing a mode for a single thing. It also made it easy to edit a preview row into "production" by accident, which the API would not even apply: the PATCH handler looks only inside the list its `is_preview` selects (ADR-0003), so toggling the flag silently did nothing. Editing still sends the row's own `is_preview` in the PATCH payload, exactly as the merged list reported it — dropping it would default to `false` and edit the wrong variable.

## There is no move between sections

The obvious follow-up to two sections is a "move to Production/Preview" action. It is deliberately absent. Moving would be delete-then-create (the PATCH cannot change lists, ADR-0003), and for an `is_shown_once` secret that means the value is read once and then destroyed: the source record's stored secret cannot be carried to the new list, so a "move" would silently lose the secret or force a re-entry. The user can achieve the same effect explicitly — add in the target section, delete in the source — with full visibility of the value cost. No confirmation dialog can make the destructive case safe, so the action is not offered at all.

## Only applications get the section

Services accept `is_preview` in the API and their flat list can contain preview rows, but the Env Editor only splits the list for applications. Preview deployments are an application concept — pull requests deploy applications, never services or databases — so a Preview section on a service would present rows the UI cannot otherwise act on (no previews to configure). Their list stays flat; `is_preview` is still echoed back on save, because the PATCH routes on it (ADR-0003).

## Why two stacked collapsible sections over the alternatives

- **Tabs** were rejected: the count, the search, and the reveal toggle are global, and a tab switch would hide the other list while the user searches across both.
- **A filter/segmented control** was rejected: it treats the split as a view mode over one list, which is exactly the framing that hid the duplicate-key reality; and it made "add" ambiguous (which list does the button write to?).
- **Moving with confirmation** was rejected for the `is_shown_once` reason above.

## Behavior notes

- The Preview section always exists for applications, even empty and with previews disabled; its collapsed state derives from the resource — open when `is_preview_deployments_enabled` is true or preview variables exist — and a manual toggle wins until the drawer re-targets another resource. The flag comes from `GET /applications/{uuid}` (the list endpoint does not return `settings`, per the spec), fetched by the Drawer and passed down; the Env Editor makes no fetch of its own.
- Search is global; if the query matches preview rows the section opens itself, and clearing the query returns it to the derived state. Each section shows its own `n of m` while filtering.
- Duplicate keys are only checked within a section: the same key in both lists is the intended override, not an error.
- Preview variables existing while `is_preview_deployments_enabled` is false shows an inline warning in the section header; editing and adding stay available, and the Env Editor does not touch the Application's settings.
- Each section sorts by key A-Z client-side, which also fixes the inherited inconsistency where production arrived in `id` order and preview already arrived alphabetically.
