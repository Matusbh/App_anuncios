**English** | [Español](README.es.md)

# Snaprime

> Paste a website URL → get an AI-generated brand profile and ready-to-edit ads, persisted in a database, deployed on Cloudflare Workers.

**Live demo:** https://tanstack-start-app.matusbh-dev.workers.dev

Built for a Snaprime take-home technical exercise. See [`BRIEF.md`](BRIEF.md) for the original assignment.

## What it does

1. Paste a URL.
2. The app extracts the page's content — with a headless-browser fallback ([Browserless](https://browserless.io)) for JS-rendered pages that a plain fetch can't read.
3. Claude turns that content into a structured brand profile (what they do, target audience, value proposition, tone of voice, color palette, candidate images) — never inventing facts; missing data is reported as `"not_found"`, not guessed.
4. Claude generates 1-3 on-brand ads from that profile, each with a creative concept, primary text, headline, description, CTA, and an image chosen only from the page's own candidate images (never a hallucinated URL).
5. Everything is persisted in Postgres. From the project page you can edit any ad's text fields inline, or regenerate a single ad — edits to one ad are guaranteed not to be clobbered by regenerating another.

## Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) (React), server functions (`createServerFn`) for all backend logic.
- **Deploy:** Cloudflare Workers, via `@cloudflare/vite-plugin` (runs on workerd/Miniflare in both dev and build).
- **Database:** PostgreSQL on [Neon](https://neon.tech), via [Drizzle ORM](https://orm.drizzle.team). Driver: `drizzle-orm/neon-http` + `@neondatabase/serverless` (see [Key decisions](#key-decisions) — this mattered).
- **AI:** Anthropic API via `@anthropic-ai/sdk` directly.
  - Brand profile: `claude-haiku-4-5` (factual extraction — fast and cheap).
  - Ads: `claude-sonnet-5` (creative copywriting benefits from more capability).
- **JS rendering fallback:** Browserless (REST `/content` endpoint).
- **Validation:** Zod on every LLM input/output and every server function input.
- **HTML parsing:** `node-html-parser` (pure JS, works under Workers' `nodejs_compat`).

## Project structure

```
src/
  db/
    schema.ts               -- Drizzle tables (projects, brand_profiles, ads) + inferred types
    index.ts                 -- Drizzle client (neon-http)
  integrations/
    web-extraction/          -- extractPageContent: simple fetch + Browserless fallback + parsing
    brand-profile/            -- generateBrandProfile: LLM (Haiku) -> Zod-validated profile
    ad-generation/             -- generateAds / regenerateOneAd: LLM (Sonnet) -> validated ads
  server/
    projects.ts                -- createProject, getProject (server functions)
    ads.ts                      -- updateAd, regenerateAd (server functions)
  routes/
    index.tsx                    -- URL input + project creation
    project.$projectId.tsx        -- project view: profile + editable ad cards
  lib/
    limits.ts                     -- centralized timeouts/thresholds
  test/
    test-extraction.ts             -- manual test script for extractPageContent
    test-brand-profile.ts          -- manual test script for extraction + brand profile
    test-ad-generation.ts          -- manual test script for extraction + profile + ads + regen
```

Each `integrations/` module is independent and was tested in isolation (its own script under `src/test/`) before being wired into anything else.

## Getting started

```bash
npm install
cp .env.example .env.local  # fill in DATABASE_URL, ANTHROPIC_API_KEY, BROWSERLESS_TOKEN
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

> **Windows + ProtonVPN:** if DB connections fail with `ECONNRESET` or hang, fully quit ProtonVPN (tray icon → Exit, not just "disconnect") — its network filter interferes with the SSL handshake to Neon even while "disconnected." See `dificultades.md`.

### Deploying

```bash
npm run deploy
```

Environment variables in `.env.local` are **not** uploaded automatically — set them as Worker secrets once:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put BROWSERLESS_TOKEN
```

## Database schema

**`projects`** — `id`, `url`, `status` (`pending` → `extracting` → `ready`/`failed`), `error_message` (also used for "partially degraded but still usable" results, not just total failures), `total_tokens_used`, `processing_time_ms`, timestamps.

**`brand_profiles`** — one per project. The four text fields (`what_they_do`, `target_audience`, `value_proposition`, `tone_of_voice`) are `NOT NULL`: the row is only inserted once the LLM's `"not_found"` fallback has already been applied, so the schema itself guarantees there's never a silent null. `color_palette`/`candidate_images` are nullable JSONB arrays.

**`ads`** — one row per generated ad, `is_user_edited` flips to `true` on manual edit and resets to `false` on regeneration (it's new generated content, not a hand edit anymore).

## Key decisions

**Neon's HTTP driver, not `node-postgres`.** The initial scaffold used `drizzle-orm/node-postgres`. During production verification, GET requests immediately following a POST would hang under the Cloudflare Workers runtime — persistent TCP connections (`pg.Pool`) aren't reliably reusable across separate Worker invocations, even in local Miniflare. Switched to `drizzle-orm/neon-http` + `@neondatabase/serverless`, Neon's official recommendation for Workers. Full diagnosis in `dificultades.md`.

**Direct Anthropic SDK, not `@tanstack/ai-anthropic`.** The scaffold had `@tanstack/ai-anthropic` installed, but its `structuredOutput()` is built to be driven by `@tanstack/ai`'s full chat/agent engine (typed internal logger, its own message format) — more machinery than a single isolated "send context, get validated JSON" call needs. Used `@anthropic-ai/sdk` directly instead, with the same forced tool-call pattern the adapter uses internally.

**`node-html-parser`, not native `HTMLRewriter`.** Cloudflare's native `HTMLRewriter` avoids a dependency, but its streaming/handler API is considerably more verbose for pulling several fields (title, meta, headings, images, colors) out of one document. With `nodejs_compat` enabled, a lightweight pure-JS parser is just as viable and much simpler to write against.

**No queue, no real progress stream.** `createProject` is a single blocking call doing extraction plus two LLM calls synchronously (typically 10-30s). There's no job queue or SSE — the "steps" shown on the home page while creating a project are client-side timers, not real server push. A deliberate scope cut; see below.

**`imageUrl` is schema-constrained, not just prompted.** The ad-generation tool's JSON Schema sets `enum: candidateImages` (or `enum: ['']` when there are none) on the `imageUrl` field, so Claude is constrained at generation time to one of the page's real images — never a hallucinated URL. Zod re-validates the same constraint as a backstop.

**Graceful degradation, never total loss.** If brand-profile generation fails, the project still saves as `ready` with what extraction produced; if ad generation fails, the profile that was already generated is kept. `status: 'failed'` is reserved for when extraction itself fails and there's genuinely nothing to show.

## Cost/latency limits

All timeouts live in `src/lib/limits.ts` (previously `LLM_TIMEOUT_MS` was duplicated with the same value in two separate files):

| Constant                       | Value | What it bounds                                           |
| ------------------------------ | ----- | -------------------------------------------------------- |
| `SIMPLE_FETCH_TIMEOUT_MS`      | 15s   | Plain `fetch` of the page                                |
| `BROWSERLESS_TIMEOUT_MS`       | 20s   | JS-rendering fallback                                    |
| `LLM_TIMEOUT_MS`               | 25s   | Each Claude call (profile and ads share this)            |
| `SLOW_PROCESSING_THRESHOLD_MS` | 60s   | Above this, the UI flags the run as slower than expected |

- At most 1 retry per LLM call when the output fails Zod validation (2 attempts total).
- Visible text sent to the brand-profile LLM is truncated to 6,000 characters.
- Every call's token usage is logged server-side, including the reason a retry was triggered.
- **Visible in the UI, not just server logs:** the project page shows `Generated in {seconds}s · {tokens} tokens used` right under the status. If a run exceeds the slow-processing threshold, an explicit banner explains that something may have degraded due to a timeout.

## What was consciously deferred

- Real project-creation progress (SSE/polling) — simulated with client-side timers instead.
- Manual image swap/upload (the brief allows for it; this iteration only covers inline text editing).
- Advanced candidate-image dedup/filtering.
- Precise brand-color extraction (only checks inline `style=""` attributes, not full stylesheets).
- Explicit SSRF hardening on arbitrary user-submitted URLs.
- Automated tests — only manual verification scripts under `src/test/` and ad-hoc Playwright checks during development.

## Known issues (fixed)

- Ad generation occasionally failed Zod validation twice in a row on pages with very generic, non-commercial content (e.g. a Wikipedia article), surfacing a cryptic `ads: Invalid input` error. Root cause: on rare, unusually verbose generations the response was truncated at the `max_tokens` ceiling mid-JSON, leaving the tool call's `ads` array missing entirely rather than malformed — and the generic retry hint didn't tell the model why, so the retry often truncated again too. Fixed by raising the token ceiling (2x typical usage) and detecting `stop_reason === 'max_tokens'` explicitly to give the retry a specific "be more concise" hint instead of a generic one. See `dificultades.md` #8 for the full diagnosis.

## How this was tested

- `web-extraction`: `npx tsx src/test/test-extraction.ts` against real URLs (static, SPA, 404, nonexistent domain).
- `brand-profile`: `npx tsx src/test/test-brand-profile.ts`.
- `ad-generation`: `npx tsx src/test/test-ad-generation.ts` (includes a `regenerateOneAd` check comparing the original vs. regenerated creative idea).
- Full browser flow: verified with an ad-hoc Playwright script (installed temporarily, not part of the repo) that creates a real project, edits one ad card, regenerates a different one, and confirms via screenshot that the first edit survives untouched — both locally and against the deployed Cloudflare URL, including a full page reload to confirm the edit was persisted server-side, not just held in client state.

## Using an AI coding agent

**Agent/harness:** Claude Code (Claude Sonnet 5).

Used for essentially the whole build: designing and applying the Drizzle schema, the three integration modules (extraction, brand profile, ads) each tested in isolation before being wired together, the server functions, the TanStack Start routes, the Cloudflare deploy, and end-to-end verification in a real browser (an ad-hoc Playwright script, since no headless-browser CLI was preinstalled in this Windows environment).

**Where it helped most:** diagnosing the Cloudflare Workers connection-hanging bug — it correctly identified that `node-postgres`/`pg.Pool` isn't reliable under the Workers runtime and proposed and applied the fix (Neon's `neon-http` driver) instead of endlessly retrying the same failing approach.

**Where it needed correction:** confirming, twice, that ProtonVPN was genuinely fully closed (not just "disconnected") when the Neon connection kept failing intermittently — the agent diagnosed the cause correctly but has no way to act on the user's own operating system.

---

More detailed running notes (in Spanish) live in [`documentacion.md`](documentacion.md) and [`dificultades.md`](dificultades.md).
