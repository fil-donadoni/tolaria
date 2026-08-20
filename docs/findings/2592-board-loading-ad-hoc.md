---
title: board.tsx's own pre-state loading div is still ad hoc, not LoadingScreen
discoveredBy: 2592
status: draft
confidence: medium
---

**What is wrong.** `src/components/board/board.tsx:275-280` renders a raw
`<div className="flex h-full items-center justify-center text-white">Loading...</div>`
while `state` is not yet available — the same "loading" moment the shared
`LoadingScreen` component (issue #2592) now covers everywhere else in the app.

**Evidence.**

```tsx
// src/components/board/board.tsx:275-280
if (!state) {
    return (
        <div className="flex h-full items-center justify-center text-white">
            Loading...
        </div>
    );
}
```

It shares the `/game` route with `waiting-for-opponent.tsx`, which this issue
DID convert to the shared `EmptyState`.

**Why it may not deserve its own issue (yet).** `LoadingScreen` is themed for
the light/lobby surfaces (`bg-surface-base`, `AmbientPageGround`); the board is
a dark, fullscreen `/game` surface (`text-white`, no ambient ground, `h-full`
inside a container that IS already the viewport). Swapping it in as-is would
be a visible dark→light flash on the single hottest render path in the app
(every game load), and no v3 token/Panel variant for a DARK immersive loading
moment exists yet — building one is a design decision, not a mechanical swap,
and outside this issue's audited-surface list (issue #2592 names "board
waiting-for-opponent", not "board's own pre-state spinner"). Worth a line on
the next system-states or Immersive-surface sweep rather than a standalone
ticket today.
