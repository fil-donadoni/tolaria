---
title: chrome-devtools-mcp's single shared profile blocked #2635's browser verification too — second occurrence
discoveredBy: 2635
status: draft
confidence: high
---

**What is wrong.** Same failure as
`docs/findings/2633-chrome-devtools-mcp-shared-profile-blocks-concurrent-verification.md`,
recurring on a different issue: every `chrome-devtools-mcp` server on this
machine launches Chrome against the same fixed `userDataDir`, and whichever
session's Chrome process launches first holds an exclusive lock on it for as
long as that process lives. Every other concurrent session's
`list_pages`/`new_page`/`navigate_page` calls fail hard with `The browser is
already running for .../chrome-profile. Use --isolated to run multiple
browser instances.`

**Evidence.** Working #2635, `list_pages`/`new_page` failed identically on
every retry. `ps aux` at the time showed the Chrome browser process itself
(`--user-data-dir=/Users/filippo/.cache/chrome-devtools-mcp/chrome-profile`,
`--remote-debugging-pipe`) had been running for **02:58:08** (started ~10:01
local), while at least three separate `chrome-devtools-mcp` node server
process groups were alive concurrently (started at roughly 06:01-ish the
previous day, ~14:13, and ~14:59 by their `chrome-devtools-mcp`/watchdog PIDs'
elapsed times) — several sessions queued behind one lock, exactly the #2633
shape, on a different day.

**Impact on this issue.** #2635's AC required a browser-verification receipt
(five viewports, probe measurements) for `scripts/telemetry-dashboard.html`,
which `bun run check:ui` does not cover (no `telemetry`/`dashboard` surface in
`scripts/ui-gate/surfaces.ts` — confirmed again). The change shipped without
that receipt, stated explicitly in the PR body, for the same reason #2633
did: `bun run check:lane` is green (including the whole `node` project driving
the new `shortcuts.js`/`history-state.js` round-trip logic through happy-dom),
the work itself is not untested — only the live-browser layout pass could not
run.

**This is the second independently-discovered occurrence within the same PRD
(#2621)'s slice batch.** #2633's own finding named the test for whether this
"deserves its own issue yet": grep how often other passes report the same
`chrome-profile` error. Two hits from two different issues in the same batch,
both blocked for the full session rather than a transient few seconds, reads
like the answer is yes — a per-session/per-worktree profile dir (or an
`--isolated` flag on the driver's own `chrome-devtools-mcp` invocation) would
let concurrent verification passes coexist instead of queuing behind whichever
session got there first.
