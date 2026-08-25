---
title: The telemetry dashboard serves no favicon, so every page load logs a 404 console error
discoveredBy: 2625
status: draft
confidence: medium
---

**What is wrong.** `telemetry-serve.ts` has no `/favicon.ico` route, so Chrome's
automatic favicon request falls through to the catch-all `404` on every single
page load of the dashboard. It is invisible in normal use and loud in exactly the
place PRD #2621 is heading: any later ticket that asserts "zero console errors on
this surface" (the standard receipt shape in `.claude/rules/chrome-debug.md`)
reds on it and has to special-case the noise.

**Evidence.** Measured on this branch's own browser verification, store-absent
run at `http://127.0.0.1:5198/`:
`list_console_messages {types:["error"]}` → three entries, of which
`msgid=7 [error] Failed to load resource: … 404` is
`GET /favicon.ico` (confirmed by hand:
`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5198/favicon.ico` → `404`).
The catch-all is `scripts/telemetry-serve.ts` — the final
`return new Response("not found", { status: 404 })` in `handleRequest`.

Pre-existing: the route never existed, and #2625 did not change it. #2625 does
make it a one-line fix now that there is a static-asset allow-list
(`DASHBOARD_ASSET_NAMES`) to hang it off.

**Why it may not deserve its own issue.** It is cosmetic today — nothing is
broken, and a `data:` favicon or an empty 204 would close it in one line. It is
probably a checklist line on whichever #2621 ticket first writes a browser
receipt for this surface, not a ticket of its own. The argument for a ticket is
that the console-error assertion is the standard receipt in this repo, and a
known-noisy baseline is how such assertions quietly get dropped.
