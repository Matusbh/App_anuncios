# Dificultades y soluciones

Registro vivo de cosas en las que nos hemos atascado durante el desarrollo y cómo las resolvimos. Se actualiza cada vez que aparece un bloqueo nuevo.

---

## 1. `drizzle-kit push` pide confirmación interactiva al borrar/crear tablas a la vez

**Cuándo:** Al aplicar el schema inicial (`projects`, `brand_profiles`, `ads`) sustituyendo la tabla de ejemplo `todos`.

**Síntoma:** `npm run db:push` fallaba con `Error: Interactive prompts require a TTY terminal` — drizzle-kit detectaba que se borraba una tabla (`todos`) y se creaban otras nuevas, y quería preguntar interactivamente si alguna era un "rename" de `todos`. En un entorno no interactivo (agente) eso no se puede responder.

**Solución:** Borrar `todos` manualmente con una query SQL directa (`DROP TABLE IF EXISTS todos`) *antes* de correr `db:push`. Así drizzle-kit ve un DROP y unos CREATE en pasos separados, sin ambigüedad de rename, y no pregunta nada.

---

## 2. `node-html-parser` cuela el `<!DOCTYPE html>` como texto visible

**Cuándo:** Construyendo `extractPageContent` en `src/integrations/web-extraction/`.

**Síntoma:** El campo `visibleText` empezaba literalmente con `<!DOCTYPE html>` seguido del contenido real, ensuciando lo que luego le mandamos al LLM.

**Causa:** `node-html-parser` trata la declaración `<!DOCTYPE ...>` como un `TextNode` normal en vez de un nodo especial, así que aparece dentro de `textContent`.

**Solución:** Quitar el doctype con una regex (`html.replace(/<!DOCTYPE[^>]*>/i, '')`) antes de parsear, dentro de `extractVisibleText`.

---

## 3. ESLint marca como "código muerto" comprobaciones de null que sí hacen falta

**Cuándo:** Escribiendo las server functions (`src/server/projects.ts`, `src/server/ads.ts`).

**Síntoma:** `@typescript-eslint/no-unnecessary-condition` marcaba como error cosas como `if (!project) throw notFound()` después de `const [project] = await db.select()...`.

**Causa:** El `tsconfig.json` del proyecto tiene `noUncheckedIndexedAccess` desactivado, así que TypeScript asume que `const [x] = array` siempre da `x: T` (nunca `undefined`), aunque en tiempo real de ejecución una query `SELECT ... WHERE` sí puede devolver `[]`. El lint confía en ese tipo (incorrecto) y marca la comprobación como redundante.

**Solución:** Distinguir dos casos:
- Si el array *sí* está garantizado no-vacío (ej. `INSERT ... RETURNING` de una sola fila), quitar la comprobación: es código muerto de verdad.
- Si el array *puede* estar vacío de verdad (ej. `SELECT ... WHERE id = ?` con un id que podría no existir), usar `.at(0)` en vez de destructuring — `Array.prototype.at()` está tipado como `T | undefined` siempre, independientemente de `noUncheckedIndexedAccess`, así que TypeScript y ESLint quedan de acuerdo con la realidad.

---

## 4. ProtonVPN interfiere con la conexión SSL a Neon

**Cuándo:** Verificando el flujo completo en el navegador (edición + regeneración de anuncios).

**Síntoma:** Timeouts y `ECONNRESET` intermitentes al conectar a la base de datos, tanto desde la app como desde scripts sueltos de verificación. Coincide exactamente con el aviso que ya existía en `CLAUDE.md`.

**Causa:** ProtonVPN activo en la máquina interfiere con la negociación SSL hacia Neon.

**Solución:** Cerrar ProtonVPN **del todo** (icono de la bandeja del sistema → Salir/Exit), no basta con "desconectar" desde la interfaz — los procesos de servicio (`ProtonVPNService.exe`, `ProtonVPN.WireGuardServic...`) siguen corriendo en segundo plano y algunas VPN mantienen un kill-switch/filtro de red activo incluso "desconectadas". Confirmado con conexiones directas de prueba antes/después.

---

## 5. El driver de DB (`node-postgres`) se colgaba bajo el runtime de Cloudflare Workers

**Cuándo:** Verificando el flujo completo en el navegador, después de resolver el problema de la VPN.

**Síntoma:** `createProject` (POST) funcionaba siempre bien, pero la petición inmediatamente siguiente — `getProject` (GET, disparada por navegación *client-side* vía RPC) — se quedaba colgada hasta que el runtime de Workers la mataba: `"The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response."` Reiniciar el servidor de dev no lo arreglaba; el patrón se repetía en cada intento.

**Diagnóstico:** Una petición SSR directa a `/project/:id` (sin pasar por navegación cliente) respondía en <1s, así que la base de datos en sí funcionaba bien. El problema era específico de reutilizar una conexión TCP persistente (`pg.Pool` vía `drizzle-orm/node-postgres`) entre invocaciones separadas del Worker — algo que el runtime de Cloudflare Workers no soporta de forma fiable (los sockets no sobreviven bien entre invocaciones, incluso en Miniflare simulando el entorno real).

**Solución:** Cambiar `src/db/index.ts` de `drizzle-orm/node-postgres` (+`pg`) a `drizzle-orm/neon-http` (+`@neondatabase/serverless`) — el driver HTTP sin estado que Neon recomienda oficialmente para Cloudflare Workers. Cambio acotado a ese archivo; no tocó `schema.ts` ni ninguna query. Esto no era solo un problema de verificación local: sin este cambio, el fallo muy probablemente habría reaparecido igual en producción, ya desplegado a Cloudflare Workers de verdad.

---

## 6. No hay navegador headless disponible por defecto en este entorno Windows

**Cuándo:** Intentando verificar el flujo completo en un navegador real (edición + regeneración de anuncios).

**Síntoma:** El patrón recomendado (`chromium-cli`) para conducir un navegador headless no estaba instalado ni disponible en este entorno Windows (a diferencia de un contenedor Linux típico).

**Solución:** Instalar Playwright de forma temporal con `npm install --no-save playwright` (no queda en `package.json`/lockfile) + `npx playwright install chromium`, escribir un script de verificación ad-hoc, y desinstalarlo (`npm uninstall playwright`) al terminar. Quedó fuera del repo, solo se usó para esta verificación puntual.
