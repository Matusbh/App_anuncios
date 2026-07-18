/**
 * Limites de tiempo/coste centralizados. Un unico sitio para ver y ajustar
 * los timeouts de toda la pipeline (extraccion + LLM) y el umbral que
 * dispara el aviso de "esto tardo mas de lo esperado" en la UI.
 */

/** Fetch simple de una pagina: rapido, sin renderizado. Si tarda mas que esto, algo va mal (red lenta, servidor colgado). */
export const SIMPLE_FETCH_TIMEOUT_MS = 15_000

/** Browserless renderiza con un navegador real: mas lento que un fetch simple por naturaleza. */
export const BROWSERLESS_TIMEOUT_MS = 20_000

/** Llamadas a Claude (perfil de marca y anuncios). Mismo timeout para ambas: son llamadas de un solo turno con salida acotada por max_tokens. */
export const LLM_TIMEOUT_MS = 25_000

/**
 * Umbral por encima del cual createProject se considera "lento" y la UI
 * muestra un aviso. No es un limite duro (no cancela nada) — solo hace
 * visible cuando el pipeline completo se acerca a la suma de sus timeouts
 * individuales (extraccion + fallback + 2 llamadas al LLM, con reintentos).
 */
export const SLOW_PROCESSING_THRESHOLD_MS = 60_000
