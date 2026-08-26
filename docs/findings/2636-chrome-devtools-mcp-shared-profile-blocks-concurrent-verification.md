---
title: chrome-devtools-mcp's single shared profile blocked #2636's browser verification too — third occurrence
discoveredBy: 2636
status: draft
confidence: high
---

**What is wrong.** Same failure as
`docs/findings/2633-chrome-devtools-mcp-shared-profile-blocks-concurrent-verification.md`
and `docs/findings/2635-chrome-devtools-mcp-shared-profile-blocks-concurrent-verification.md`,
a third time: `new_page`/`list_pages` both refused with "The browser is
already running for .../chrome-profile. Use --isolated to run multiple
browser instances." — the shared `userDataDir` was held by another
concurrent session for the whole attempt, with no way to request an isolated
instance from a tool call (`--isolated` is a server-launch flag).

**Evidence.** Working #2636 (also parented under #2621, the same PRD as
#2635), both `mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page` (with
and without `isolatedContext`) and `...__list_pages` failed identically on
first attempt.

**Impact on this issue.** Same shape as #2633/#2635: `scripts/dashboard/**`
has no browser-verification lane at all (`bun run check:ui` does not walk it —
no `telemetry`/`dashboard` entry in `scripts/ui-gate/surfaces.ts`, confirmed
again), so the ONLY way to visually verify a dashboard UI change is a manual
`chrome-devtools-mcp` session — and that path is now blocked on its third
consecutive dashboard-UI issue in the same PRD's slice batch. Substituted an
HTTP-level structural check (asset 200s, meta-token injection, a live
`/api/loop-status` response carrying the new `remedyAction` field against this
machine's real running driver) plus the full happy-dom behavioural suite —
real, but not a substitute for seeing the five-viewport layout render.

**This is now three independently-discovered occurrences in one PRD's slice
batch (#2633, #2635, #2636), all on `scripts/dashboard/**`changes.** #2633's
own finding proposed the test: "grep how often other passes report the same`chrome-profile`error… reads like the answer is yes [it deserves its own
issue]." Three for three now. The two candidate fixes named in #2635's finding
(a per-session/per-worktree`userDataDir`, or an `--isolated`flag on the
driver's own`chrome-devtools-mcp` invocation) are unchanged; what is new is
the count.
