Context
Snaprime is building a product that replaces a big chunk of a marketing agency’s work: paste a website URL and within seconds get a brand profile, usable photos, and ready-to-edit ads. This assignment is a thin vertical slice of that core loop.
We are not looking for a perfect system or a pretty isolated demo. We want to see you ship one thing end-to-end on our real stack and deploy it so we can run the whole flow ourselves. Budget ~5–6 focused hours (of course, feel free to give it more) inside a 72-hour window. A smaller working whole beats a big unfinished ambition.
You won’t finish everything — and that’s the point
This brief is deliberately a little bigger than 5–6 hours. We want to see what you prioritize under time pressure. Ship the core flow first, then spend whatever is left on robustness and polish. In your README, tell us what you cut and why. We grade prioritization and judgment, not completeness.
What you’ll build
A new standalone app with this spine:

1.  Input — one URL field and a “Create” button.
2.  Extraction + brand profile — from the URL, produce a structured profile: what the client does, who it’s for, the main value proposition, the brand tone/voice, a small brand color palette, and a few candidate images from the page. Don’t invent facts the site doesn’t state — say “not found” instead.
3.  AI generation — generate 1–3 ads. Each has a short creative idea plus ad-ready fields: primary text, headline, description, CTA, and a chosen image. On-tone, no hallucinated facts.
4.  Editable preview — render the ads as human previews (not raw JSON). For each ad: edit any text, swap or upload an image, and regenerate just that one ad. State persists — edits and regeneration must not overwrite each other.
5.  Deploy to Cloudflare — reachable by us, so we run the whole flow ourselves.
    Required stack
    • TanStack Start
    • Cloudflare (Workers/Pages) for deploy
    • TypeScript
    • A cloud hosted database of your choice for persistence
    • AI model and SDK of your choice
    Hard requirements
    • Works on URLs you haven’t hard-coded for — no per-domain selectors.
    • Handles JavaScript-rendered pages. A plain HTML fetch that returns an empty shell must not defeat you. At least one test URL we give you will be JS-rendered, and it must work. We expect you to reach for a real rendering service — use whichever you like (e.g. Cloudflare Browser Rendering, Browserless, a hosted Playwright). A documented graceful fallback earns partial credit if a full solution doesn’t fit the time budget.
    • Doesn’t hallucinate facts that aren’t on the page.
    • Doesn’t crash on a broken/unreadable page — degrades gracefully and explains why a result is partial.
    • Edit and regenerate-one-ad both persist and don’t clobber each other.
    • A sane cost/latency cap, surfaced somewhere (log or UI).
    Everything beyond this — caching, image dedup/filtering, SSRF, precise brand-color extraction — is your call. Defer consciously and defend it in the README.
    Note on the rendering service: some options, including Cloudflare Browser Rendering, may require a paid plan or have tight free-tier limits. Pick whatever you can stand up quickly — we don’t care which vendor, only that you solved the problem.
    Engineering — we’re watching how you set it up
    No checklist. Set the project up the way you’d want to build on it with an AI agent for the next year, not hack together for a weekend. We’ll notice what’s there and what isn’t.
    How you used the AI agent
    A short note: which agent(s) you used, the prompts that mattered, where it helped, and where it failed and you had to correct it.
    What we’ll give you
    3–5 real test URLs (a couple intentionally rough, including at least one JS-rendered).
    What to submit
6.  A deployed Cloudflare URL we can open and run.
7.  The git repo.
8.  A README covering your approach, what AI harness and LLM was used during development, key decisions and what you consciously deferred.
9.  The short AI-agent note above.
    What we score
    • Ship quality — does the whole flow really work end-to-end, deployed?
    • Robust extraction — works on unseen and JS-rendered pages.
    • AI layer — useful, on-tone, no hallucinations.
    • Engineering judgment — a repo set up for serious, agent-driven development.
    • Product/UX judgment — sensible previews, edit/regenerate, persistence.
    • Working with the LLM— used it smartly and critically, not blindly.
    • Prioritization — what you chose to build vs. defer, and how well you defended it.
    Time
    ~5–6 focused hours inside a 72-hour window. If something doesn’t fit, that’s fine — be clear about what works, what doesn’t, why you deferred it, and how you’d continue.
