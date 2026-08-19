---
title: A page that starts HIDDEN never leaves "Loading..." — usePageVisible skips the first fetch and nothing re-fires
discoveredBy: 2551
status: draft
confidence: medium
---

**What is wrong.** `usePageVisible()` is used to pass `"skip"` to the lobby's
and the board's Convex queries while the tab is hidden. That is right as a
_pause_, but it is also the FIRST value on a cold load: if the document is
already `hidden` when the route mounts, every gated query stays `undefined`,
the route renders `<LoadingScreen />`, and nothing recovers until a
`visibilitychange` event fires. There is no console error, no network error and
no timeout — the screen is a spinner with a fan-content disclaimer, forever.

`visibilitychange` does fire when the user comes back to a tab they switched
away from, which is why this is invisible in normal use. It does NOT fire for a
window that was never visible in the first place: a page restored into a
background window, a second monitor asleep, a link opened in a background tab
that is then never focused before the user gives up, or any automated browser
session (this is how I hit it — a CDP-driven Chrome that is not frontmost
reports `hidden`, and the lobby spun for ~15 minutes of debugging before
`Emulation.setFocusEmulationEnabled` fixed it).

**Evidence.**

- `src/hooks/usePageVisible.ts:8-10` — `getSnapshot` returns
  `document.visibilityState === "visible"`, so a cold mount in a hidden document
  starts `false`.
- `src/components/lobby/lobby.tsx:82,89,95` — `presetDecks`, `openGames`,
  `activeGame` are all `pageVisible ? {} : "skip"`.
- `src/components/lobby/lobby.tsx:390-396` — the gate: any of the four being
  `undefined` renders `<LoadingScreen />`. A skipped query is `undefined`
  indistinguishably from an in-flight one.
- Same shape on the board: `src/components/board/board.tsx`,
  `src/routes/game.route.tsx`, `src/components/board/manual-board-container.tsx`,
  `src/hooks/useAutoPassPhases.ts`, `src/hooks/useLimitedEvent.ts`,
  `src/routes/deck-detail.route.tsx`, `src/components/debug/debug-panel.tsx`.
- Reproduce: open the app in a window that never gets focus (or run
  `document.visibilityState` checks under CDP without focus emulation) and watch
  `/` sit on "Loading...".

**Plausible fix shape** (not implemented — out of this issue's scope): let the
gate skip only AFTER a first successful load — e.g. track "has ever been
visible" and pass `"skip"` only once data exists — so the pause keeps its
purpose (no polling for a backgrounded tab) without also blocking the initial
fetch.

**Why it may not deserve its own issue.** The realistic user path — open a tab,
look at it — always starts visible, so this may never have bitten a human. Its
real cost is to automated verification: any agent driving this app through CDP
or a headless browser will hit an unexplained permanent spinner with no error to
grep, and the browser-verification guide (`docs/guides/browser-verification.md`)
does not mention it. If the fix is judged not worth it, the cheap alternative is
one line in that guide plus `docs/guides/ui-runbooks.md`: emulate focus, or the
app never loads.
