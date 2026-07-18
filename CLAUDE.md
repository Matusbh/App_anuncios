Snaprime Exercise

Qué es esto

Ejercicio técnico para un proceso de selección. Una app que: recibe una URL → extrae info de la web (incluso si es JS-rendered) → genera con IA un perfil de marca estructurado → genera 1-3 anuncios editables → todo persistido en base de datos → desplegado en Cloudflare.

Ver BRIEF.md en la raíz para el enunciado completo del ejercicio.

Stack

Framework: TanStack Start (React) — server functions para toda la lógica backend
Deploy: Cloudflare Workers (npm run deploy → wrangler deploy)
DB: PostgreSQL en Neon, ORM Drizzle
IA: Anthropic API (Claude) vía @tanstack/ai-anthropic
Rendering JS: Browserless (fallback cuando el fetch simple no trae contenido)

Reglas del ejercicio (no negociables)

No hardcodear selectores por dominio — tiene que funcionar con cualquier URL.
Manejar páginas JS-rendered: fetch simple primero, si el contenido es pobre, fallback a Browserless.
No inventar datos que no estén en la página — usar "not_found" en su lugar.
No debe crashear con páginas rotas — degradar con gracia y explicar el motivo.
Editar un anuncio y regenerar otro no pueden pisarse entre sí (persistencia por fila/id).
Límite de coste/latencia visible (timeout + log de tokens usados).

Estructura de carpetas

src/
db/ -> esquema Drizzle (schema.ts) y cliente de conexión (index.ts)
routes/ -> rutas de TanStack Start (file-based routing)
integrations/ -> lógica de extracción web, llamadas al LLM, cliente de Browserless
components/ -> componentes React (tarjetas de anuncio, formularios, etc.)

Comandos

npm run dev — servidor local en :3000
npm run deploy — build + deploy a Cloudflare
npm run db:push — sincroniza el esquema de Drizzle con Neon (sin migraciones formales, para desarrollo rápido)
npm run db:studio — abre Drizzle Studio para inspeccionar la DB visualmente
npm run lint / npm run format — ESLint + Prettier

Aviso importante de entorno

Si una conexión a la base de datos falla con ECONNRESET o timeouts raros, comprobar que ProtonVPN esté desactivado — interfiere con la negociación SSL hacia Neon en este equipo. Ya nos pasó una vez.

Convenciones de código

TypeScript estricto, sin any salvo justificación clara.
Validar todo output del LLM con Zod antes de guardar en DB o devolver al cliente.
Server functions de TanStack Start para toda lógica que toque DB, LLM o Browserless — nunca desde el cliente directamente.
Comentarios solo donde la lógica no sea obvia (por qué, no qué).

Variables de entorno (.env.local, no se commitea)

DATABASE_URL — connection string de Neon
ANTHROPIC_API_KEY — para las llamadas al LLM
BROWSERLESS_TOKEN — para el fallback de rendering JS

Prioridades (ver plan completo en el README del proyecto)

Flujo end-to-end desplegado (input → extracción → perfil → anuncios → preview editable) — esto es lo único que importa primero.
README con decisiones y qué se dejó fuera, estructura de repo limpia, robustez de extracción.
Todo lo demás (caché, dedup de imágenes, SSRF, colores precisos) — opcional, documentar si se omite.
