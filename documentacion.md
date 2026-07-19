# Documentación técnica (borrador para el README)

Documento vivo con el detalle de decisiones, arquitectura y estado del proyecto. Se actualiza a medida que avanza el desarrollo. Sirve de base para redactar el `README.md` final que pide el enunciado.

---

## 1. Qué es esto

Snaprime: pegar una URL → extraer contenido de la web (incluso JS-rendered) → generar con IA un perfil de marca estructurado → generar 1-3 anuncios editables → todo persistido en Postgres (Neon) → editable/regenerable desde una UI → desplegado en Cloudflare Workers.

Ver `BRIEF.md` para el enunciado completo del ejercicio y `CLAUDE.md` para las reglas no negociables del proyecto.

**URL desplegada:** https://tanstack-start-app.matusbh-dev.workers.dev — flujo end-to-end verificado en producción (extracción con fallback de Browserless, perfil de marca, anuncios, edición persistida en la DB real, todo confirmado con un reload completo tras editar). Ver §12.

## 2. Stack

- **Framework:** TanStack Start (React), server functions (`createServerFn`) para toda la lógica de backend.
- **Deploy:** Cloudflare Workers (`npm run deploy` → `wrangler deploy`), vía `@cloudflare/vite-plugin` (corre sobre workerd/Miniflare tanto en dev como en build).
- **DB:** PostgreSQL en Neon, ORM Drizzle. Driver: `drizzle-orm/neon-http` + `@neondatabase/serverless` (ver §7.1 — decisión importante).
- **IA:** Anthropic API vía `@anthropic-ai/sdk` directo (no `@tanstack/ai-anthropic`, ver §7.2).
  - Perfil de marca: `claude-haiku-4-5` (extracción factual, rápido y barato).
  - Anuncios: `claude-sonnet-5` (copywriting creativo, se beneficia de más capacidad).
- **Rendering JS:** Browserless (REST `/content`, fallback cuando el fetch simple trae poco contenido).
- **Validación:** Zod en toda entrada/salida del LLM y en el input de las server functions.
- **Parsing HTML:** `node-html-parser` (pura JS, compatible con `nodejs_compat` de Workers).

## 3. Estructura de carpetas

```
src/
  db/
    schema.ts          -- tablas Drizzle (projects, brand_profiles, ads) + tipos inferidos
    index.ts            -- cliente Drizzle (neon-http)
  integrations/
    web-extraction/     -- extractPageContent: fetch simple + fallback Browserless + parsing
    brand-profile/       -- generateBrandProfile: LLM (Haiku) -> perfil validado con Zod
    ad-generation/       -- generateAds / regenerateOneAd: LLM (Sonnet) -> anuncios validados
  server/
    projects.ts          -- createProject, getProject (server functions)
    ads.ts               -- updateAd, regenerateAd (server functions)
  routes/
    index.tsx             -- input de URL + creación de proyecto
    project.$projectId.tsx -- vista de proyecto: perfil + tarjetas de anuncio editables
  test/
    test-extraction.ts     -- prueba manual de extractPageContent contra URLs reales
    test-brand-profile.ts  -- prueba manual de extracción + perfil de marca
    test-ad-generation.ts  -- prueba manual de extracción + perfil + anuncios + regeneración
```

Cada módulo de `integrations/` es independiente y se probó de forma aislada (con script propio en `src/test/`) antes de conectarlo a nada.

## 4. Esquema de base de datos

### `projects`
| columna | tipo | notas |
|---|---|---|
| id | serial PK | |
| url | text NOT NULL | |
| status | text NOT NULL, default `'pending'` | tipado en TS como `'pending' \| 'extracting' \| 'ready' \| 'failed'` vía `.$type<>()`, aunque en DB es texto libre |
| error_message | text, nullable | motivo de fallo total o parcial. También se usa para "extracción parcial pero el resto salió bien" (ver §6.1) — no es exclusivo de fallos totales. |
| total_tokens_used | integer, nullable | suma de tokens (input+output) de las llamadas al LLM que tuvieron éxito dentro de `createProject`. Nullable porque filas creadas antes de esta instrumentación no lo tienen. |
| processing_time_ms | integer, nullable | tiempo total de `createProject`, desde el primer insert hasta el update final. |
| created_at / updated_at | timestamp, default now() | `updated_at` se pone a mano en cada `.update()` (no hay `.$onUpdate()` configurado) |

### `brand_profiles`
| columna | tipo | notas |
|---|---|---|
| id | serial PK | |
| project_id | integer NOT NULL, FK → projects.id, `onDelete: cascade` | |
| what_they_do / target_audience / value_proposition / tone_of_voice | text **NOT NULL** | Decisión: NOT NULL en vez de nullable. La fila solo se inserta una vez completada la extracción con el fallback `"not_found"` ya aplicado, así que el propio schema garantiza que nunca hay null silencioso — si algún día un insert no trae el campo, falla en vez de colar un null. |
| color_palette / candidate_images | jsonb, nullable | array de strings (colores hex / URLs). Nullable tal cual se especificó; puede venir como `[]` cuando se buscó y no se encontró nada (distinto de `null` = nunca se tocó). |
| created_at | timestamp | |

### `ads`
| columna | tipo | notas |
|---|---|---|
| id | serial PK | |
| project_id | integer NOT NULL, FK → projects.id, `onDelete: cascade` | |
| creative_idea / primary_text / headline / description / cta / image_url | text, nullable | |
| is_user_edited | boolean NOT NULL, default false | true tras `updateAd`, se resetea a false tras `regenerateAd` (es contenido nuevo generado, no editado a mano) |
| created_at / updated_at | timestamp | |

## 5. Módulos de integración

### 5.1 `web-extraction` — `extractPageContent(url)`

1. Fetch simple con timeout de 15s y User-Agent de navegador normal.
2. Si el texto visible (fuera de `script`/`style`/`noscript`) tiene menos de 250 caracteres, se asume SPA/JS-rendered y se cae a Browserless (`POST {base}/content?token=...`, timeout 20s).
3. Extrae: title, meta description, headings h1/h2/h3 (agrupados por nivel), texto visible principal (además excluye `nav`/`header`/`footer`), imágenes candidatas (og:image + primeras `<img>` con src absoluto, filtrando iconos por width/height cuando están presentes, máx. 8), colores (meta theme-color + hex en atributos `style=""` inline, máx. 5).
4. Manejo de errores: nunca lanza. Devuelve `{success:false, errorReason}` en fallo total; `{success:true, partial:true, partialReason}` en contenido mínimo/parcial (incluye el caso "Browserless también falló pero hubo algo de texto del fetch simple").
5. Un 404/500 real en el fetch simple corta ahí mismo — no se intenta Browserless (no tiene sentido pagar un render completo por una página que no existe).

### 5.2 `brand-profile` — `generateBrandProfile(extracted)`

- Modelo: `claude-haiku-4-5`.
- Prompt con título/meta/headings/texto visible (truncado a 6.000 caracteres, constante `MAX_VISIBLE_TEXT_CHARS`) + instrucción explícita de responder `"not_found"` literal si un dato no está.
- Salida forzada vía tool call de Anthropic (`tool_choice`), validada con Zod (`brandProfileLlmSchema`, campos de texto `min(1)` — aceptan `"not_found"`, solo rechazan string vacío).
- Si la validación falla, reintenta **una vez** con el error de Zod en el prompt. Si falla la segunda vez, `{success:false, errorReason}`.
- `colorPalette`/`candidateImages`: si el LLM no aporta nada, cae a lo que ya trajo la extracción (`extracted.colors`/`extracted.candidateImages`).
- Loguea tokens de cada intento por consola (`[generateBrandProfile] intento N - tokens: input=... output=...`), y también el motivo cuando una validación falla (para que el gasto de tokens de un retry tenga explicación visible).

### 5.3 `ad-generation` — `generateAds(brandProfile)` / `regenerateOneAd(brandProfile, previousAd?)`

- Modelo: `claude-sonnet-5` (copywriting, se justifica más capacidad que Haiku).
- Mismo patrón de timeout/retry/logging que `brand-profile`, factorizado en un helper interno compartido (`requestStructuredAdOutput`) dentro del propio módulo (no se comparte código con `brand-profile` para no acoplar ambos módulos).
- **`imageUrl` nunca inventado:** el JSON Schema de la tool call incluye `enum: candidateImages` (o `enum: ['']` si no hay ninguna) — Anthropic queda forzado a elegir literalmente de la lista al generar (constrained decoding), y Zod valida lo mismo como backstop.
- `generateAds` genera entre 1 y 3 anuncios (el LLM decide cuántos tienen sentido; el prompt pide no rellenar con variaciones débiles solo por llegar a 3).
- `regenerateOneAd` genera exactamente 1. Si se pasa `previousAd`, el prompt incluye su `creativeIdea`/`headline` con instrucción explícita de no repetir esa idea.

## 6. Server functions y rutas

### 6.1 `createProject(url)` — POST

Pipeline con **degradación progresiva**: si un paso falla, se guarda lo que ya se generó en vez de perderlo todo.

1. Insert `projects` (`status: 'pending'`) → update a `'extracting'`. Se marca `startedAt = Date.now()` al principio del handler.
2. `extractPageContent`. Si falla del todo → `status: 'failed'`, `error_message`, fin.
3. `generateBrandProfile`. Si falla → `status: 'ready'` igualmente (la extracción sí sirvió), `error_message` explica que el perfil falló, sin fila en `brand_profiles`.
4. Insert `brand_profiles`. Se suman `profileResult.usage.inputTokens + outputTokens` al acumulador `totalTokensUsed`.
5. `generateAds`. Si falla → `status: 'ready'` (el perfil ya se guardó), `error_message` explica que los anuncios fallaron.
6. Insert `ads` (batch). Se suma también el usage de `generateAds`. `status: 'ready'`. Si `extracted.partial` fue `true` (la extracción se degradó, ej. por un timeout de Browserless) aunque el resto del pipeline saliera bien, `error_message` lo refleja igualmente en vez de quedar en `null` — ese detalle ya no se pierde silenciosamente.

`status: 'failed'` queda reservado para cuando no hay nada aprovechable (falló la extracción misma). Cualquier otro fallo parcial deja el proyecto en `'ready'` con lo que se pudo generar.

En **todos** los caminos de salida (incluido el de fallo total) se persiste `totalTokensUsed` y `processingTimeMs: Date.now() - startedAt`. Limitación conocida: `totalTokensUsed` solo suma tokens de llamadas al LLM que tuvieron éxito — un intento fallido (ej. el primero de un retry) sí gastó tokens reales, pero como `generateBrandProfile`/`generateAds` no devuelven `usage` en su rama de fallo, ese gasto no queda contabilizado en el total. Los logs de consola (`[generateX] intento N - tokens: ...`) sí muestran cada intento por separado si hace falta auditar el gasto real.

### 6.2 `getProject(projectId)` — GET

Trae `project` + `brandProfile` (o `null`) + `ads[]`. `throw notFound()` si el proyecto no existe.

### 6.3 `updateAd(adId, fields)` — POST

Actualiza solo los campos pasados de una fila (`primaryText`/`headline`/`description`/`cta`/`imageUrl`, todos opcionales pero al menos uno requerido vía `.refine()`), marca `is_user_edited: true`, `updated_at: new Date()`. No toca otras filas.

### 6.4 `regenerateAd(adId)` — POST

Busca el ad y su `brand_profile` (vía `project_id`), llama a `regenerateOneAd` pasando el ad actual como `previousAd`, actualiza solo esa fila y resetea `is_user_edited: false`. Devuelve `{success:false, errorReason}` si el LLM falla (no lanza — es un resultado esperado, no una excepción) o si el proyecto no tiene perfil de marca guardado.

### 6.5 Rutas

- `/` (`index.tsx`): input + botón, pasos de carga simulados con temporizadores del lado cliente (no hay SSE/polling real de progreso — simplificación consciente, documentada). Navega a `/project/$projectId` al terminar.
- `/project/$projectId` (`project.$projectId.tsx`): `params.parse`/`stringify` para manejar el id como número. Loader llama a `getProject`. Estado local de `ads` (`useState`, sembrado desde el loader, con `key={project.id}` en el componente hijo para forzar reset si se navega a otro proyecto) — así "regenerar" o "editar" una tarjeta actualiza solo esa fila en la UI sin recargar ni tocar las demás.

## 7. Decisiones de arquitectura importantes

### 7.1 Driver de base de datos: `neon-http`, no `node-postgres`

Empezamos con `drizzle-orm/node-postgres` (scaffold inicial). Durante la verificación en navegador se detectó que las conexiones TCP persistentes (`pg.Pool`) se colgaban de forma intermitente bajo el runtime de Cloudflare Workers (confirmado con Miniflare local: una petición SSR directa funcionaba, pero una petición GET disparada por navegación *client-side* justo después de una POST se quedaba colgada hasta que el runtime la mataba). Se cambió a `drizzle-orm/neon-http` + `@neondatabase/serverless` (HTTP sin estado), el driver que Neon recomienda oficialmente para Cloudflare Workers. Detalle completo en `dificultades.md` §5.

### 7.2 SDK de Anthropic directo, no `@tanstack/ai-anthropic`

El scaffold inicial traía `@tanstack/ai-anthropic` instalado. Su método `structuredOutput()` está pensado para ser invocado por el motor de chat/agente de `@tanstack/ai` (requiere un `logger` interno tipado, conversión de mensajes a su formato propio, etc.) — de más maquinaria de la necesaria para llamadas aisladas de "manda contexto, recibe JSON validado". Se usa `@anthropic-ai/sdk` directo (ya era dependencia transitiva) con el mismo patrón de tool-forzada que usa el adapter por debajo, pero de forma simple y transparente.

### 7.3 Parsing HTML: `node-html-parser`, no `HTMLRewriter` nativo

Cloudflare Workers ofrece `HTMLRewriter` nativo (cero dependencias), pero su API de streaming por handlers es más verbosa para extraer varios campos a la vez (title, meta, headings, imágenes, colores). Con `nodejs_compat` activado en `wrangler.jsonc`, una librería ligera pura-JS como `node-html-parser` funciona igual de bien en Workers y da código de extracción mucho más simple.

### 7.4 No hay caché ni cola de trabajos

`createProject` es una única llamada bloqueante que hace extracción + 2 llamadas al LLM de forma síncrona (15-40s típico). No hay job queue ni progreso real vía SSE — los "pasos" que ve el usuario en `/` son simulados con temporizadores. Decisión consciente por alcance del ejercicio; ver `documentacion.md` §9 para qué se dejó fuera.

## 8. Límites de coste/latencia (requisito del enunciado)

Todos los timeouts están centralizados en `src/lib/limits.ts` (antes estaban sueltos y duplicados: `LLM_TIMEOUT_MS` existía por separado, con el mismo valor, en `brand-profile` y en `ad-generation`):

- `SIMPLE_FETCH_TIMEOUT_MS` = 15s — fetch simple de una página.
- `BROWSERLESS_TIMEOUT_MS` = 20s — fallback de renderizado JS.
- `LLM_TIMEOUT_MS` = 25s — llamadas a Claude (perfil de marca y anuncios, comparten el mismo valor).
- `SLOW_PROCESSING_THRESHOLD_MS` = 60s — umbral por encima del cual la UI avisa de que `createProject` tardó más de lo esperado (no cancela nada, solo hace visible la anomalía).

Además:
- Máx. 1 reintento en cada llamada al LLM si la salida no valida contra Zod (2 intentos totales).
- Texto visible truncado a 6.000 caracteres antes de mandarlo al LLM del perfil de marca.
- Tokens de cada llamada (y de cada intento de retry, con el motivo de por qué falló el intento anterior) logueados por consola.
- **Visible en la UI, no solo en logs de servidor:** la página de proyecto muestra `Generado en {segundos}s · {tokens} tokens usados` justo debajo del estado (`total_tokens_used`/`processing_time_ms` persistidos en `projects`, ver §4). Si `processing_time_ms` supera `SLOW_PROCESSING_THRESHOLD_MS`, aparece un aviso explícito de que el proceso tardó más de lo esperado y pudo haberse degradado algo por un timeout.

## 9. Qué se dejó fuera / deferido conscientemente

*(completar a medida que se decida qué entra en la ventana de tiempo del ejercicio y qué no — ver también `BRIEF.md` §"Todo lo que está más allá de esto...")*

- Progreso real de creación de proyecto (SSE/polling) — se simula con temporizadores.
- Swap/upload manual de imagen por parte del usuario (el brief lo menciona como posible, pero esta iteración solo cubre edición de campos de texto).
- Dedup/filtrado avanzado de imágenes candidatas.
- Extracción precisa de colores de marca (solo mira `style=""` inline, no hojas de estilo completas).
- SSRF hardening explícito en la extracción de URLs arbitrarias.
- Tests automatizados (solo hay scripts de verificación manual en `src/test/`).

## 10. Cómo se probó cada pieza

- `web-extraction`: `npx tsx src/test/test-extraction.ts` contra URLs reales (estática, SPA, 404, dominio inexistente).
- `brand-profile`: `npx tsx src/test/test-brand-profile.ts`.
- `ad-generation`: `npx tsx src/test/test-ad-generation.ts` (incluye prueba de `regenerateOneAd` comparando idea creativa original vs. regenerada).
- Flujo completo en navegador: verificado con un script Playwright ad-hoc (instalado temporalmente, no forma parte del repo) que crea un proyecto real, edita una tarjeta, regenera otra distinta, y confirma por captura de pantalla que la primera edición sobrevive intacta. Ver `dificultades.md` para el detalle de los problemas que aparecieron durante esa verificación (VPN, driver de DB).

## 11. Nota sobre el uso del agente de IA

*(esto alimenta la sección obligatoria del README sobre "cómo usaste el agente")*

- **Agente/harness:** Claude Code (Claude Sonnet 5).
- Se usó para: diseño y aplicación del schema de Drizzle, los 3 módulos de integración (extracción, perfil de marca, anuncios) probados de forma aislada antes de conectarlos, las server functions, las rutas de TanStack Start, y la verificación end-to-end en navegador real (Playwright ad-hoc).
- **Dónde ayudó de forma notable:** diagnóstico del bloqueo de conexión a la base de datos bajo el runtime de Cloudflare Workers (identificó que `node-postgres`/`pg.Pool` no es fiable en Workers y propuso + aplicó el cambio a `neon-http`, el driver recomendado por Neon) en vez de quedarse reintentando a ciegas.
- **Dónde hizo falta corregirlo / intervención humana:** confirmar dos veces que ProtonVPN estaba realmente cerrado del todo (no solo "desconectado") cuando la conexión a Neon fallaba de forma intermitente — el agente diagnosticó bien la causa pero no podía actuar sobre el sistema operativo del usuario.

## 12. Deploy a Cloudflare Workers

**URL:** https://tanstack-start-app.matusbh-dev.workers.dev

Pasos seguidos:

1. `npm run deploy` (`vite build` + `wrangler deploy`). Compiló y desplegó sin errores de compatibilidad con el runtime de Workers a la primera — no hizo falta ningún ajuste de código para el deploy en sí.
2. Las variables de entorno de `.env.local` **no** se suben solas (tal como avisa `CLAUDE.md`) — hubo que configurarlas como secrets del Worker con `wrangler secret put DATABASE_URL` / `ANTHROPIC_API_KEY` / `BROWSERLESS_TOKEN`, leyendo los valores de `.env.local` y pasándolos por stdin (nunca como argumento de línea de comandos, para no dejarlos en el historial de shell). Confirmado con `wrangler secret list` antes (vacío) y después (los 3 presentes).
3. Los secrets de Cloudflare se aplican de inmediato al Worker ya desplegado, sin necesidad de un segundo deploy.

**Verificación end-to-end en producción** (con `https://quotes.toscrape.com/js/`, para forzar también el fallback de Browserless):
- Proyecto creado en ~12.7s, perfil de marca generado correctamente, 3 anuncios generados (sin `candidateImages` en este sitio → los 3 muestran "Sin imagen" tal como se espera).
- El resumen de coste/latencia se ve correctamente: "Generado en 12.7s · 3.645 tokens usados".
- Se editó el headline de un anuncio y **se recargó la página completa** (nueva carga SSR desde cero, no solo estado de React) — el cambio seguía ahí, confirmando que la edición se persiste en la base de datos de producción real, no solo en memoria del cliente.
- Sin errores de consola durante todo el flujo.
