---
title: check:ui could not complete a five-viewport RECEIPT run — shared machine was running 5+ concurrent worktree sessions
discoveredBy: 1735
status: draft
confidence: high
---

**What is wrong.** This PR's diff repoints several UI display sites
(`stack-row.tsx`, `convoke-creature-dialog.tsx`, `band-formation-panel.tsx`,
`damage-assignment-panel.tsx`, `mana-tap-other-banner.tsx`,
`payment-banner.tsx`, `target-selection-banner.tsx`, `trigger-order-prompt.tsx`,
`useBattlefieldInteraction.tsx`, `card-image-signature.ts`) at a viewer's own
face-down permanent/spell — a diff `.claude/rules/chrome-debug.md` requires a
`bun run check:ui` RECEIPT for. I ran it twice from
`/Users/filippo/code/mtg/tolaria-issue-1735` and neither run reached a clean
five-viewport pass:

- Run 1: completed desktop (1440x900x2), phone portrait (390x844x3) and phone
  landscape (844x390x3) with real probe numbers, then crashed opening tablet
  portrait (820x1180x2): `error: async newContext: Target page, context or
browser has been closed`. Every surface from that viewport on printed
  `UNWALKED`.
- Run 2 (retry): the dev server / browser connection oscillated
  (`[vite] connecting...` / `connected.` repeating every few seconds) for the
  full 5-minute wall clock, then was force-killed without completing even the
  first viewport's walk.

**Evidence.** At the time of both runs, `ps aux` showed this machine running
at least five concurrent agent worktrees, each with its own heavy process:
`tolaria-issue-2761` (`vitest run --project bot-node --project bot-dom`,
2 forked workers), `tolaria-issue-1969` (a `vite --port 5199` dev server),
`tolaria-issue-2671` and `tolaria-issue-2664` (their own `vite` dev servers),
plus the primary `tolaria` checkout's own `vite`. `check:ui` (`scripts/ui-gate/
index.ts:202`, `chromium.launch()`) starts its OWN fresh headless Chrome — it
is not a profile-lock collision with `chrome-devtools-mcp`'s shared
`~/.cache/chrome-devtools-mcp/chrome-profile` (that MCP plugin launches its
own separate Chrome processes, independently observed running 3× concurrently
in `ps aux` at the same time) — so the failure mode here is plain CPU/memory
contention from several sessions' Vite dev servers + vitest workers +
Playwright's Chromium all fighting for the same machine, not a single shared
lock either script could coordinate on.

**Why it may not deserve its own issue (yet).** This is the FIRST time I
personally hit it hard enough to fail twice in a row, and it may simply be
this particular hour's batch size rather than a standing gap. It's worth a
ticket only if it recurs: a mitigation would be `check:ui` detecting an
already-hot machine (load average, or counting sibling `vite`/`vitest`
processes) and either queuing behind a mutex (the way `scripts/gate.ts`
already machine-wide-mutexes the heavy tier for `bun run test`/`check:all`) or
failing fast with a "machine busy, retry" message instead of burning 5+
minutes to a hard timeout with no usable partial signal. I did not attempt
that fix here — it's an orchestration/scheduling change to `check:ui` and/or
`scripts/gate.ts`, well outside this issue's scope.

**Correction (round-2 review) — a browser was not the missing verification
here, and I overstated its role in the first draft.** The round-1 review
found a real regression in `src/lib/battlefield-stacks.ts` (two DIFFERENT
face-down permanents the controller controls collapsing into one rendered
pile) that had nothing to do with this contention: none of the runbooks
`bun run check:ui` drives (`docs/guides/ui-runbooks.md`) walk a face-down
board at all, so even a clean five-viewport RECEIPT run on this PR would very
likely have walked straight past it — there was no face-down permanent on
screen for the probe to measure. The actual gap was a missing NODE-level
test: `battlefield-stacks.wire.test.ts` now drives the exact scenario through
the real `projectPublicState` + `groupBattlefield` and catches the collapse
directly, no browser involved (same for `displayCardId`/`getCardImageDefId`
themselves, which had zero automated coverage before this round — see
`src/lib/__tests__/card-utils.test.ts`, "issue #1735 review, finding 3").
Framing the missing `check:ui` run as the reason this shipped was wrong; the
remedy was, and is, targeted vitest coverage of the pure view-reducer
functions this PR added, which a browser pass would not have substituted
for.
