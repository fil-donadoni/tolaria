---
title: Other h-dvh usages under AppShell can hit the same defect-3 overflow shape
discoveredBy: 2056
status: draft
confidence: medium
---

**What is wrong.** Issue #2056's own proposed fix for defect 3 said "check
every other `h-dvh` under `AppShell` for the same shape while you are
there." A grep after fixing `pool-deck-builder-form.tsx` and `deck-builder.tsx`
turns up several more `h-dvh`/`h-screen` full-viewport claims that render
directly under `AppShell`'s header band (any route where
`shellShowsHeader()` is true, i.e. everything except `/game`):

- `src/components/ui/loading-screen.tsx:17` — `h-dvh` — rendered directly by
  `PoolDeckBuilder` while `event`/`userDecks` are loading (before
  `PoolDeckBuilderForm` mounts), so it sits under the exact same header band
  this ticket's defect 3 fix addresses for the loaded state.
- `src/components/join/join-antechamber-shell.tsx:13` — `h-dvh`.
- `src/routes/deck-builder.route.tsx:133,140,167,174,234` — five `h-screen`
  loading/not-found branches in `DeckBuilderRoute`, all rendered before
  `DeckBuilder` itself mounts.
- `src/routes/deck-detail.route.tsx:50` — `h-screen` loading branch.

**Why it may not deserve its own issue.** These are all short-lived
loading/error states (a spinner or a "not found" message), not the
interactive surface the issue's Definition of Done measures pixels against
— none of them are covered by #2056's acceptance criteria
(`document.scrollHeight === innerHeight` was only measured/asserted for the
two fully-loaded builder routes). The overflow they'd produce is the same
112px-of-header shape, but the user-visible cost is much smaller (a
transient loading screen scrolling slightly, not an entirely-unusable
90-card pool). Worth folding into a follow-up "sweep every h-dvh/h-screen
under AppShell" pass rather than a dedicated issue on its own — could
plausibly land as a one-line-per-site fixup once someone is already in
`app-shell.tsx`/`shellChrome.ts` for something else.
