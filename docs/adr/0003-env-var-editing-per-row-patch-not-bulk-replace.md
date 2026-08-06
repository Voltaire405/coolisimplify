# 0003 Env var editing uses PATCH-by-key and delete-then-create renames

The env var editor embedded in Details edits one variable at a time. Value/flag edits are a single `PATCH /{type}/{uuid}/envs` whose payload is `{ key, value, is_literal, is_multiline, is_preview }` — Coolify routes the update by `(key, is_preview)`, and `is_preview` defaults to `false` when omitted, so sending the wrong flag edits the wrong variable or returns 404. Deletes are `DELETE /{type}/{uuid}/envs/{env_uuid}`.

We deliberately did **not** use Coolify's `PATCH /{type}/{uuid}/envs/bulk`: its payload contains no `env_uuid` and Coolify treats it as a full replacement of the env set — any var absent from the payload is deleted. With per-key PATCH, a save can only ever change the variable the user touched, so a stale or partial list can never silently drop vars, and a failure maps cleanly to the row that caused it.

Three consequences of the real API shape (verified against the synced `coolify-openapi-v4.x.yaml` and the live v4.x source):

1. **There is no `PATCH /{type}/{uuid}/envs/{env_uuid}`.** The item path only supports DELETE. An earlier draft of this design assumed a per-`env_uuid` PATCH; that endpoint does not exist, so the client PATCHes the collection path keyed by `(key, is_preview)` instead. `apps/web/lib/envs.test.ts` asserts the item path exposes only `delete`, so a future spec sync that adds a per-env PATCH will fail loudly and prompt a revisit.
2. **Renaming a key is delete-then-create.** Because PATCH is routed by the (new) key, a pure PATCH cannot rename. The editor therefore deletes the old row and creates the new key in one save operation. If the create fails after the delete, the row is gone; the inline error says so.
3. **A variable cannot change list (Production ↔ Preview) via PATCH.** Each branch of Coolify's update handler looks only inside its own list — the `environment_variables` branch searches the non-preview rows and the `environment_variables_preview` branch the preview ones — so flipping `is_preview` in the payload never applies. Moving a variable between lists is delete-then-create, which is also why the Env Editor does not offer a move action (ADR-0008).

The three flags `is_literal`, `is_multiline`, and `is_preview` are editable; the rest (`is_runtime`, `is_buildtime`, `is_shared`, `is_shown_once`) are displayed as read-only badges. `is_preview` is not sent for databases — the database env endpoints accept only `is_literal`, `is_multiline`, and `is_shown_once`.
