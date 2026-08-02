# Troubleshooting

## 422 "Validation failed" / "This field is not allowed." al clonar recursos

**Síntoma**: al clonar un recurso (application/service/database) desde el dashboard, la creación falla con `422 Unprocessable Entity`; el mensaje de Coolify lista campos "not allowed".

**Causa raíz**: Coolify valida los bodies de creación contra un **allowlist estricto** (`ApplicationsController.php`: `array_diff(array_keys($request->all()), $allowedFields)`). Cualquier campo fuera de la lista → 422. La estrategia de blocklist (copiar el detalle del GET "menos los campos conocidos") no puede funcionar: el detalle trae muchos más campos de los que el endpoint acepta.

**Regla**: cuando el consumidor valida con allowlist, el productor debe construir con allowlist. Enumerar lo permitido, no lo prohibido.

**Solución aplicada** (en `apps/web/lib/clone.ts`):
- Payloads construidos solo con campos de una allowlist explícita por tipo (`APP_CREATE_ALLOWLIST`, `DB_COMMON_ALLOWLIST`), no copia genérica del detalle.
- Sanear valores válidos-pero-incorrectos: `static_image` (solo `nginx:alpine`), `redirect` (solo `www|non-www|both`), `docker_compose_domains` (solo build pack dockercompose).
- Apps `dockercompose` no reciben `domains` (Coolify exige `docker_compose_domains`).
- `github_app_uuid` = uuid del source (vía `GET /github-apps`), no el `source_id` numérico.
- Credenciales de BD por motor según su allowlist (p. ej. `keydb_password`, `dragonfly_password`, mongodb no acepta password).
- Sin `as unknown as` en los casts: el payload se construye con el tipo create concreto, dejando que el compilador valide las claves.

**Verificación**: `scratchpad/check-payload.mjs` genera un detalle completo desde el spec, lo pasa por la lógica de construcción y valida contra el allowlist/required reales de cada endpoint (app, service, db + credenciales por motor).
