# Troubleshooting

## 422 "Validation failed" / "This field is not allowed." al clonar recursos

**Síntoma**: al clonar un recurso (application/service/database) desde el dashboard, la creación falla con `422 Unprocessable Entity`; el mensaje de Coolify lista campos "not allowed".

**Causa raíz**: Coolify valida los bodies de creación contra un **allowlist estricto** (`ApplicationsController.php`: `array_diff(array_keys($request->all()), $allowedFields)`). Cualquier campo fuera de la lista → 422. La estrategia de blocklist (copiar el detalle del GET "menos los campos conocidos") no puede funcionar: el detalle trae muchos más campos de los que el endpoint acepta.

**Regla**: cuando el consumidor valida con allowlist, el productor debe construir con allowlist. Enumerar lo permitido, no lo prohibido.

**Solución aplicada** (en `apps/web/lib/clone.ts`):
- Payloads construidos solo con campos de una allowlist explícita por endpoint (`APP_CREATE_ALLOWLIST`, `DOCKERFILE_CREATE_ALLOWLIST`, `DB_COMMON_ALLOWLIST`), no copia genérica del detalle.
- Sanear valores válidos-pero-incorrectos: `static_image` (solo `nginx:alpine`), `redirect` (solo `www|non-www|both`), `docker_compose_domains` (solo build pack dockercompose).
- Apps `dockercompose` no reciben `domains` (Coolify exige `docker_compose_domains`).
- `github_app_uuid` = uuid del source (vía `GET /github-apps`), no el `source_id` numérico.
- Credenciales de BD por motor según su allowlist (p. ej. `keydb_password`, `dragonfly_password`, mongodb no acepta password).
- Sin `as unknown as` en los casts: el payload se construye con el tipo create concreto, dejando que el compilador valide las claves.

**Verificación**: `pnpm check:clone-payload`. Recorre los quince flujos de clonado (app vía GitHub App / Dockerfile / Docker Compose, servicio y los ocho motores de BD, incluida una tanda de motores mixtos), construye el payload desde un detalle sintético con **todos** los campos del schema poblados y lo valida contra el schema de request de `coolify-openapi-latest.yaml` más las reglas extra del controlador. No toca ninguna instancia: es determinista y corre en menos de un segundo.

Fuentes: `scripts/check-clone-payload.mjs` y `scripts/coolify-spec.mjs`. Requiere Node 22+ por `--experimental-strip-types` (importa el `clone.ts` real, así que valida el código de producción, no una copia).

Cuando aparezca un 422 nuevo, el orden que funciona es: reproducirlo en este script antes de tocar `clone.ts`, y no darlo por arreglado hasta que el script pase. Un fix verificado solo contra la instancia real es difícil de distinguir de un fix que ni siquiera llegó al bundle.

### El allowlist no es uno solo: es uno por endpoint

`POST /applications/dockerfile` acepta un subconjunto **estrictamente menor** que `POST /applications/private-github-app`: rechaza todo lo específico de git y de build pack (`git_repository`, `git_branch`, `install_command`, `build_command`, `start_command`, `publish_directory`, `is_static`, `is_spa`, `static_image`, `watch_paths`, `dockerfile_location`, `docker_compose_*`, `is_preserve_repository_enabled`, `is_auto_deploy_enabled`). Usar un allowlist único para ambos 422 en el flujo Dockerfile. En `clone.ts` esto es `DOCKERFILE_CREATE_ALLOWLIST = APP_CREATE_ALLOWLIST - GITHUB_ONLY_FIELDS`.

### La fuente de verdad es el OpenAPI del repo, no el controlador PHP

`coolify-openapi-latest.yaml` describe la versión de Coolify contra la que corre este dashboard. Un `ApplicationsController.php` descargado de `main` puede listar campos que esa versión **no** acepta todavía — `custom_network_aliases` es el caso: aparece en `$allowedFields` del controlador actual pero no existe en el schema de request del create, y enviarlo 422 la clonación de cualquier app de repo privado. Validar contra el PHP da falsos negativos; validar contra el spec del repo es lo correcto.

### Campos que no round-trippean entre GET y CREATE

El detalle que devuelve el GET no es un body de create válido, ni siquiera restringido al allowlist. Hay que transformar:

| Campo | GET devuelve | CREATE espera |
|---|---|---|
| `custom_labels` | texto plano | base64 (`isBase64Encoded()`, si no → 422) |
| `dockerfile` | texto plano | base64 |
| `docker_compose_raw` | texto plano | base64 |
| `docker_compose_domains` | string JSON `{"svc":{"domain":"…"}}` | array `[{name, domain}]` |

`custom_labels` es el más traicionero: se valida en `validateDataApplications()`, que corre en todas las ramas de `create_application`, así que rompe los cuatro flujos de app por igual. El síntoma es exactamente `{"message":"Validation failed.","errors":{"custom_labels":"The custom_labels should be base64 encoded."}}`.

**Cadena vacía ≠ ausente.** El chequeo es `$request->has('custom_labels')`, que da `true` para `""`. Y el mensaje de error es el mismo en los dos checks consecutivos del controlador:

```php
if (! isBase64Encoded($request->custom_labels)) → 422   // línea 4286
$customLabels = base64_decode($request->custom_labels);
if (mb_detect_encoding($customLabels, 'UTF-8', true) === false) → 422   // línea 4295
```

Una cadena vacía pasa el primero y **falla el segundo** (no hay codificación que detectar), devolviendo un mensaje que culpa al base64 cuando el problema es el campo vacío. `toBase64('') === ''`, así que codificar no arregla nada: hay que **omitir el campo**. Aplica igual a `dockerfile`, que viene vacío en apps que compilan desde un Dockerfile del repo (exponen `dockerfile_location`, no el contenido).

Ojo con `detectApplicationKind`: una app de **repo privado** cuyo build pack es `dockerfile` o `dockercompose` entra por la rama `private-github-app` (gana `source_id`), así que también necesita estos transforms.

**Cómo leer un 422 nuevo**: el toast ya incluye el campo culpable — `CoolifyClient.formatError()` aplana el `errors` de la respuesta, que antes se descartaba dejando solo un `"Validation failed."` inútil. Si necesitas más detalle, en Chrome DevTools → Network revisa el **Request Payload**, no solo la respuesta: el valor exacto que viaja distingue "el fix no basta" de "el fix no llegó al bundle".
