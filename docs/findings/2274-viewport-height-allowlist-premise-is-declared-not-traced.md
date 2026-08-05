---
title: The viewport-height allowlist verifies a DECLARED route path, not the allowlisted component's actual render sites
discoveredBy: 2274
status: draft
confidence: medium
---

**What is wrong.** Issue #2274's repo-wide guard
(`src/components/chrome/__tests__/shell-height-claims.guard.test.tsx`) fails on
any new `h-dvh`/`h-screen`/`min-h-dvh`/`min-h-screen` in `src/` unless the file
is on a four-entry allowlist. Each allowlist entry carries a `routePath`, and
the guard checks `shellShowsHeader(routePath) === false` — so the exemption's
premise ("this never renders under the shared header") is verified rather than
merely asserted. But the `routePath` is **declared by the allowlist entry**, not
derived from where the component is actually rendered. The guard therefore
catches "a new file claims a viewport height" and "an allowlisted route stopped
being fullscreen", but **not** "an allowlisted component acquired a second
render site on a headered route".

**Evidence.** `src/components/board/waiting-for-opponent.tsx:37` claims `h-dvh`
and is allowlisted with `routePath: "/game/abc123"`. Its only caller today is
`src/routes/game.route.tsx:82`, so the premise holds. It is, however, a
near-clone of `src/components/ui/loading-screen.tsx` (same
`relative flex … items-center justify-center overflow-hidden bg-surface-base`
frame around `AmbientPageGround` + a centred `Panel`), and `LoadingScreen` IS
rendered on six headered routes (`lobby.tsx:392`, `limited-event-detail.tsx:86`,
`limited-events-page.tsx:46`, `pool-deck-builder.tsx:26,33,39`,
`join-game.tsx:111`) as well as on `/game` (`game.route.tsx:153`). A future
"share the waiting state with the lobby" change would reintroduce exactly the
#2274 overflow (a whole viewport under a ~112px header band) with a green guard.

**Why it may not deserve its own issue.** There is no defect today — every
allowlisted file really is `/game`-only, and the two structural halves of the
gap are each cheap to close by other means: converting
`waiting-for-opponent.tsx` to `min-h-full` like its `LoadingScreen` twin would
shrink the allowlist to genuine board machinery (`game.route.tsx`,
`manual-board.tsx`) without any new mechanism at all. Tracing render sites
statically — resolving JSX usages across the import graph to route roots — is a
much heavier guard than the leak justifies, and the same information is
available for free the moment the allowlist is empty of shared components.
Better folded into whatever next touches the board's own height machinery
(explicitly out of scope for #2274) than cut as a ticket on its own.
