---
title: chrome-devtools-mcp's single shared profile blocks browser verification whenever two sessions need it at once
discoveredBy: 2633
status: draft
confidence: high
---

**What is wrong.** Every `chrome-devtools-mcp` server on this machine launches
Chrome against the same fixed `userDataDir`
(`/Users/filippo/.cache/chrome-devtools-mcp/chrome-profile`), and Chrome
refuses a second instance against a profile dir already in use. The first
session to call any browser tool (`list_pages`, `new_page`, `navigate_page`,
…) wins the lock for as long as its Chrome process lives; every other
concurrent session's calls to the same tools fail with `The browser is already
running for .../chrome-profile. Use --isolated to run multiple browser
instances.` — a hard error, not a queue.

**Evidence.** While working #2633, `list_pages`/`new_page` failed
consistently over several retries spread across ~10 minutes. `ps aux | grep
chrome-devtools-mcp` showed FIVE separate `chrome-devtools-mcp` server
processes alive at once (started 06:01, 07:50, 14:13, 14:59, 21:06 — clearly
different sessions across the day), but only ONE Chrome browser process
(`--user-data-dir=.../chrome-profile`, started 23:48 the previous day) — i.e.
whichever session's Chrome launched first has been holding the lock for
hours, blocking every session after it. `list_pages` never succeeded in this
worktree.

**Impact on this issue.** #2633's AC required a browser-verification receipt
(five viewports, probe measurements) for `scripts/telemetry-dashboard.html`,
which `bun run check:ui` does not cover (confirmed: no `telemetry`/`dashboard`
surface in `scripts/ui-gate/surfaces.ts`). The dashboard change shipped
without that receipt — stated explicitly in the PR body rather than silently
skipped — solely because of this contention, not because the work was
untested (`check:lane` is green, and a new `history-filters.test.ts` exercises
the actual glossary-sourced rendering through happy-dom).

**Why it may not deserve its own issue yet.** This is infra/tooling, not
`convex/`/`src/` — the fix (per-session `--isolated` profile dirs, or a
lock-wait/queue instead of a hard fail) lives in how the `chrome-devtools-mcp`
plugin is invoked (MCP server args), which is session/global config, not
something a worktree-scoped PR touches. It is worth a ticket only if this
keeps recurring — one occurrence could plausibly be "got unlucky, a
long-running session held it all night." Grep the AFK loop's own logs for how
often other passes report the same `chrome-profile` error before opening
anything; if it is a repeat offender it likely wants the driver to pass
`--isolated` (or a per-worktree profile dir keyed on the worktree path) rather
than the plugin's bare default.
