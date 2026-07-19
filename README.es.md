[English](README.md) | **Español**

# Snaprime

> Pega la URL de una web → obtén un perfil de marca generado por IA y anuncios listos para editar, persistidos en base de datos, desplegado en Cloudflare Workers.

**Demo en vivo:** https://tanstack-start-app.matusbh-dev.workers.dev

Construido para un ejercicio técnico de Snaprime. Ver [`BRIEF.md`](BRIEF.md) para el enunciado original.

## Qué hace

1. Pegas una URL.
2. La app extrae el contenido de la página — con un fallback de navegador headless ([Browserless](https://browserless.io)) para páginas JS-rendered que un fetch simple no puede leer.
3. Claude convierte ese contenido en un perfil de marca estructurado (qué hacen, público objetivo, propuesta de valor, tono de voz, paleta de colores, imágenes candidatas) — nunca inventa hechos; los datos que faltan se reportan como `"not_found"`, no se adivinan.
4. Claude genera 1-3 anuncios on-brand a partir de ese perfil, cada uno con una idea creativa, texto principal, headline, descripción, CTA, y una imagen elegida solo entre las imágenes candidatas de la propia página (nunca una URL inventada).
5. Todo se persiste en Postgres. Desde la página del proyecto puedes editar los campos de texto de cualquier anuncio en línea, o regenerar uno solo — las ediciones de un anuncio nunca se pierden al regenerar otro distinto.

## Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) (React), server functions (`createServerFn`) para toda la lógica de backend.
- **Deploy:** Cloudflare Workers, vía `@cloudflare/vite-plugin` (corre sobre workerd/Miniflare tanto en dev como en build).
- **Base de datos:** PostgreSQL en [Neon](https://neon.tech), vía [Drizzle ORM](https://orm.drizzle.team). Driver: `drizzle-orm/neon-http` + `@neondatabase/serverless` (ver [Decisiones clave](#decisiones-clave) — esto importó de verdad).
- **IA:** API de Anthropic vía `@anthropic-ai/sdk` directo.
  - Perfil de marca: `claude-haiku-4-5` (extracción factual — rápido y barato).
  - Anuncios: `claude-sonnet-5` (el copywriting creativo se beneficia de más capacidad).
- **Fallback de renderizado JS:** Browserless (endpoint REST `/content`).
- **Validación:** Zod en toda entrada/salida del LLM y en el input de cada server function.
- **Parsing HTML:** `node-html-parser` (JS puro, funciona bajo `nodejs_compat` de Workers).

## Estructura del proyecto

```
src/
  db/
    schema.ts               -- tablas Drizzle (projects, brand_profiles, ads) + tipos inferidos
    index.ts                 -- cliente Drizzle (neon-http)
  integrations/
    web-extraction/          -- extractPageContent: fetch simple + fallback Browserless + parsing
    brand-profile/            -- generateBrandProfile: LLM (Haiku) -> perfil validado con Zod
    ad-generation/             -- generateAds / regenerateOneAd: LLM (Sonnet) -> anuncios validados
  server/
    projects.ts                -- createProject, getProject (server functions)
    ads.ts                      -- updateAd, regenerateAd (server functions)
  routes/
    index.tsx                    -- input de URL + creación de proyecto
    project.$projectId.tsx        -- vista de proyecto: perfil + tarjetas de anuncio editables
  lib/
    limits.ts                     -- timeouts/umbrales centralizados
  test/
    test-extraction.ts             -- script de prueba manual para extractPageContent
    test-brand-profile.ts          -- script de prueba manual para extracción + perfil de marca
    test-ad-generation.ts          -- script de prueba manual para extracción + perfil + anuncios + regen
```

Cada módulo de `integrations/` es independiente y se probó de forma aislada (con su propio script en `src/test/`) antes de conectarlo a nada más.

## Cómo arrancarlo

```bash
npm install
cp .env.example .env.local  # rellena DATABASE_URL, ANTHROPIC_API_KEY, BROWSERLESS_TOKEN
npm run db:push
npm run dev
```

Abre `http://localhost:3000`.

> **Windows + ProtonVPN:** si las conexiones a la DB fallan con `ECONNRESET` o se cuelgan, cierra ProtonVPN del todo (icono de la bandeja → Salir/Exit, no solo "desconectar") — su filtro de red interfiere con la negociación SSL hacia Neon incluso "desconectado". Ver `dificultades.md`.

### Desplegar

```bash
npm run deploy
```

Las variables de entorno de `.env.local` **no** se suben solas — hay que configurarlas como secrets del Worker una vez:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BROWSERLESS_TOKEN
```

## Esquema de base de datos

**`projects`** — `id`, `url`, `status` (`pending` → `extracting` → `ready`/`failed`), `error_message` (también se usa para resultados "parcialmente degradados pero aprovechables", no solo fallos totales), `total_tokens_used`, `processing_time_ms`, timestamps.

**`brand_profiles`** — una por proyecto. Los cuatro campos de texto (`what_they_do`, `target_audience`, `value_proposition`, `tone_of_voice`) son `NOT NULL`: la fila solo se inserta una vez aplicado el fallback `"not_found"` del LLM, así que el propio schema garantiza que nunca hay un null silencioso. `color_palette`/`candidate_images` son arrays JSONB nullable.

**`ads`** — una fila por anuncio generado, `is_user_edited` pasa a `true` con una edición manual y vuelve a `false` al regenerar (es contenido nuevo generado, ya no una edición a mano).

## Decisiones clave

**Driver HTTP de Neon, no `node-postgres`.** El scaffold inicial usaba `drizzle-orm/node-postgres`. Durante la verificación en producción, las peticiones GET justo después de una POST se quedaban colgadas bajo el runtime de Cloudflare Workers — las conexiones TCP persistentes (`pg.Pool`) no se reutilizan de forma fiable entre invocaciones separadas del Worker, ni siquiera en Miniflare local. Se cambió a `drizzle-orm/neon-http` + `@neondatabase/serverless`, la recomendación oficial de Neon para Workers. Diagnóstico completo en `dificultades.md`.

**SDK de Anthropic directo, no `@tanstack/ai-anthropic`.** El scaffold traía `@tanstack/ai-anthropic` instalado, pero su `structuredOutput()` está pensado para ser invocado por el motor completo de chat/agente de `@tanstack/ai` (logger interno tipado, formato de mensajes propio) — más maquinaria de la que necesita una llamada aislada de "manda contexto, recibe JSON validado". Se usó `@anthropic-ai/sdk` directo, con el mismo patrón de tool-call forzada que usa el adapter por debajo.

**`node-html-parser`, no `HTMLRewriter` nativo.** El `HTMLRewriter` nativo de Cloudflare evita una dependencia, pero su API de streaming por handlers es considerablemente más verbosa para sacar varios campos (title, meta, headings, imágenes, colores) de un mismo documento. Con `nodejs_compat` activado, un parser ligero puro-JS es igual de viable y mucho más simple de escribir.

**Sin cola, sin stream de progreso real.** `createProject` es una única llamada bloqueante que hace extracción más dos llamadas al LLM de forma síncrona (típicamente 10-30s). No hay job queue ni SSE — los "pasos" que se ven en la página de inicio mientras se crea un proyecto son temporizadores del lado del cliente, no push real del servidor. Un recorte de alcance consciente; ver más abajo.

**`imageUrl` restringido por schema, no solo por prompt.** El JSON Schema de la tool de generación de anuncios fija `enum: candidateImages` (o `enum: ['']` si no hay ninguna) en el campo `imageUrl`, así que Claude queda restringido en el momento de generar a una de las imágenes reales de la página — nunca una URL inventada. Zod revalida la misma restricción como respaldo.

**Degradación con gracia, nunca pérdida total.** Si falla la generación del perfil de marca, el proyecto igual se guarda como `ready` con lo que la extracción produjo; si falla la generación de anuncios, se conserva el perfil que ya se generó. `status: 'failed'` queda reservado para cuando la extracción misma falla y genuinamente no hay nada que mostrar.

## Límites de coste/latencia

Todos los timeouts viven en `src/lib/limits.ts` (antes `LLM_TIMEOUT_MS` estaba duplicado con el mismo valor en dos archivos separados):

| Constante                      | Valor | Qué acota                                                                  |
| ------------------------------ | ----- | -------------------------------------------------------------------------- |
| `SIMPLE_FETCH_TIMEOUT_MS`      | 15s   | Fetch simple de la página                                                  |
| `BROWSERLESS_TIMEOUT_MS`       | 20s   | Fallback de renderizado JS                                                 |
| `LLM_TIMEOUT_MS`               | 25s   | Cada llamada a Claude (perfil y anuncios comparten el valor)               |
| `SLOW_PROCESSING_THRESHOLD_MS` | 60s   | Por encima de esto, la UI marca la ejecución como más lenta de lo esperado |

- Máximo 1 reintento por llamada al LLM cuando la salida falla la validación de Zod (2 intentos totales).
- El texto visible enviado al LLM del perfil de marca se trunca a 6.000 caracteres.
- El uso de tokens de cada llamada queda logueado del lado del servidor, incluyendo el motivo por el que se disparó un reintento.
- **Visible en la UI, no solo en logs de servidor:** la página del proyecto muestra `Generated in {segundos}s · {tokens} tokens used` justo debajo del estado. Si una ejecución supera el umbral de lentitud, un aviso explícito indica que algo pudo haberse degradado por un timeout.

## Qué se dejó fuera conscientemente

- Progreso real de creación de proyecto (SSE/polling) — simulado con temporizadores del lado del cliente.
- Swap/upload manual de imagen (el enunciado lo permite; esta iteración solo cubre edición de texto en línea).
- Dedup/filtrado avanzado de imágenes candidatas.
- Extracción precisa de colores de marca (solo revisa atributos `style=""` inline, no hojas de estilo completas).
- Hardening explícito contra SSRF sobre URLs arbitrarias enviadas por el usuario.
- Tests automatizados — solo scripts de verificación manual en `src/test/` y pruebas ad-hoc con Playwright durante el desarrollo.

## Problemas conocidos (resueltos)

- La generación de anuncios fallaba ocasionalmente la validación de Zod dos veces seguidas en páginas con contenido muy genérico y no comercial (por ejemplo, un artículo de Wikipedia), con un error críptico: `ads: Invalid input`. Causa raíz: en generaciones inusualmente largas, la respuesta se truncaba al llegar al límite de `max_tokens` a mitad del JSON, dejando el array `ads` de la tool call directamente ausente en vez de mal formado — y como el mensaje de reintento era genérico, el modelo no sabía por qué había fallado, así que el segundo intento a menudo se truncaba igual. Arreglado subiendo el límite de tokens (2x el uso típico) y detectando `stop_reason === 'max_tokens'` explícitamente para darle al reintento una pista específica de "sé más conciso" en vez de una genérica. Ver `dificultades.md` #8 para el diagnóstico completo.

## Cómo se probó

- `web-extraction`: `npx tsx src/test/test-extraction.ts` contra URLs reales (estática, SPA, 404, dominio inexistente).
- `brand-profile`: `npx tsx src/test/test-brand-profile.ts`.
- `ad-generation`: `npx tsx src/test/test-ad-generation.ts` (incluye una prueba de `regenerateOneAd` comparando la idea creativa original vs. la regenerada).
- Flujo completo en navegador: verificado con un script Playwright ad-hoc (instalado temporalmente, no forma parte del repo) que crea un proyecto real, edita una tarjeta de anuncio, regenera otra distinta, y confirma por captura de pantalla que la primera edición sobrevive intacta — tanto en local como contra la URL real de Cloudflare, incluyendo un reload completo de página para confirmar que la edición se persistió del lado del servidor, no solo en estado del cliente.

## Uso de un agente de IA

**Agente/harness:** Claude Code (Claude Sonnet 5).

Se usó para prácticamente toda la construcción: diseño y aplicación del schema de Drizzle, los tres módulos de integración (extracción, perfil de marca, anuncios) cada uno probado de forma aislada antes de conectarlos, las server functions, las rutas de TanStack Start, el deploy a Cloudflare, y la verificación end-to-end en un navegador real (un script Playwright ad-hoc, ya que no había ningún CLI de navegador headless preinstalado en este entorno Windows).

**Dónde ayudó más:** diagnosticando el bug de conexiones colgadas en Cloudflare Workers — identificó correctamente que `node-postgres`/`pg.Pool` no es fiable bajo el runtime de Workers, y propuso y aplicó la solución (el driver `neon-http` de Neon) en vez de seguir reintentando el mismo enfoque fallido indefinidamente.

**Dónde hizo falta corregirlo:** confirmar, dos veces, que ProtonVPN estaba realmente cerrado del todo (no solo "desconectado") cuando la conexión a Neon seguía fallando de forma intermitente — el agente diagnosticó bien la causa pero no tiene forma de actuar sobre el sistema operativo del usuario.

---

Notas de desarrollo más detalladas viven en [`documentacion.md`](documentacion.md) y [`dificultades.md`](dificultades.md).
