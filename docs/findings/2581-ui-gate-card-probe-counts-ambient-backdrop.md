---
title: The UI gate's card probe counts the decorative ambient backdrop, so every `cards*` ceiling in the lane is a coin flip
discoveredBy: 2581
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` counts "cards" with a CSS selector that
matches any `<img>` whose `src` contains `scryfall`
(`scripts/ui-gate/probe.js:137-141`). Several surfaces render
`AmbientPageGround`, a decorative full-bleed `aria-hidden` backdrop whose image
is **drawn at random on every mount** from a list that is ~72% Scryfall art
crops. That backdrop matches the selector. So on those surfaces `cards n` is 1
on some runs and 0 on others, for the same tree, and — because the backdrop
sits behind the page's opaque panels or a modal scrim — a Scryfall draw scores
`cardsOcc 1` while a local draw scores nothing at all.

`cardsZero`, `cardsOcc` and `cardsStranded` are hard floors of this lane
(`scripts/ui-gate/budgets.json` note). A ceiling that flaps for reasons
unrelated to the diff is exactly the failure mode `game-board` was withdrawn
for ("a ceiling that flaps is worse than no ceiling", same file) — except here
it is flapping silently inside surfaces that are marked `budgeted`.

**Evidence.**

- Selector: `scripts/ui-gate/probe.js:139` —
  `img[src*="scryfall"],img[src*="card-back"],img[src*="/cards/"],img[data-card-id],[data-card-id] img`,
  fed to `probe(imgs)` at `probe.js:177`.
- The element it catches: `<img data-ambient-art aria-hidden …>` at
  `src/components/ui/ambient-page-ground.tsx:111-115`. It is decorative — it is
  `aria-hidden`, it is pointer-inert, and it is not a card the user can act on.
- The randomness: `pickRandom()` at
  `src/components/ui/ambient-page-ground.tsx:7-9`, called once per mount via
  `useState(pickRandom)` at `:46`, over `AMBIENT_BG_IMAGES`
  (`src/components/ui/ambient-backgrounds.ts:66`) = `LOBBY_BG` (**8** local
  `/img/lobby-bg/*.webp`) + `CARD_ART_BG` (**21** `cards.scryfall.io` art
  crops). Only the 21 match the selector: **P(counted) ≈ 21/29 ≈ 72%** per
  surface load.
- Affected surfaces today: `design-system` and `design-system-dialog`
  (`src/routes/design-system.route.tsx:36`) and `lobby`
  (`src/components/lobby/lobby-background.tsx:13` → `<AmbientPageGround ring />`).
  `not-found-page.tsx`, `loading-screen.tsx`, `admin-page-frame.tsx`,
  `draft-lab.route.tsx` and the `join` shells mount it too, so any future
  budgeted row on those inherits the same flap.
- Measured flapping, one unchanged tree (`6b1c944c` on `feat/issue-2581`), two
  consecutive `check:ui` runs: `design-system @1440x900x2` went
  `cards n1 reach1` → `cards n0`; `design-system-dialog` gave `cards n0 occ0`
  against a ceiling of 1; `lobby` went `n39/occ1` → `n38/occ0`.
- Causation confirmed by pinning `pickRandom()` to a fixed local frame in
  `ambient-page-ground.tsx`: `cards n0` on all ten census/dialog rows and
  `lobby` at `n38/occ0` at every viewport, then reverted.

**Suggested shape of the fix** (for #2580's lane owner, not decided here):
exclude decorative images from the card probe — the narrow version is
`:not([aria-hidden="true"])` plus `:not([data-ambient-art])` on the `img`
branches of the selector; the principled version is to count only elements that
carry a card identity (`[data-card-id]`, or a `data-card` marker the card
components already own) and drop the `src`-sniffing branches entirely, which
also stops a future non-card Scryfall asset from being counted.

**Why this is not fixed in #2581's PR.** Tightening the selector changes
`cards*` on every surface at once — `lobby` drops from 39 to 38 images at all
five viewports and `cardsOcc` goes to 0 there, and the two census rows go to
`cards n0`. That is a lane-wide re-baseline of `budgets.json`, which is #2580's
artifact, measured on a tree with none of #2581's UI diff in it. Doing it
inside a design-system PR would mix a real UI change with a re-record and make
both unreviewable.

**Why it may not deserve its own issue.** It is arguably a line on #2580's own
follow-up list rather than a ticket, and the practical blast radius today is
small: `cardsOcc` is currently the only hard floor it can trip, and it trips it
only on surfaces whose ceiling is already carrying a `knownDebt` note. The
argument for a ticket is that it is a _silent_ false positive on a hard floor —
a real occluded card on the lobby deck rows would be indistinguishable from the
backdrop at `cardsOcc 1` — and that the fix is a few characters of selector
plus a `--record`.
