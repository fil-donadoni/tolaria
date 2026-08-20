---
title: ControllerPhaseRow's per-phase stop dots render below the 44px coarse-pointer touch target
discoveredBy: 2595
status: draft
confidence: medium
---

**What is wrong.** On the `/settings` phase-stops section, the YOU/OPP
per-phase stop toggles (`PhaseStopDot`, rendered inside
`ControllerPhaseRow`'s `<span className="grid h-6 w-6 place-items-center …">`
gutters, `src/components/board/controller-phase-row.tsx:77` and `:112`) render
at **24×24px** at every `pointer: coarse` viewport measured (390×844,
844×390, 820×1180, 1180×820) — well under the 44px ADR 0101 §2 / WCAG 2.5.8
contract this PR's own Settings/Sign-out fixup restores elsewhere in the same
diff. Measured at 820×1180×2 (tablet portrait): 14 phase rows are visible in
the viewport, each with two 24×24 dots either side of the label, with more
rows below the fold (BEGINNING → ENDING is a longer list than one screen
holds, so the touch-contract miss compounds with a scroll the user has to
find first).

**Evidence.** `h-6 w-6` = 24px is a Tailwind literal, not the `--control-h`/
`--control-h-sm` pointer-aware token pair (`src/index.css` §3, ADR 0101 §2)
that every other control this slice touched now resolves through. It is
unconditional — the same 24×24 gutter renders on a fine pointer too, so this
is not a regression introduced by adding the coarse rung; the row's geometry
has simply never been on the token system.

**Why it is not this PR's fix.** `ControllerPhaseRow` is shared verbatim
between two call sites:

- `src/components/board/controller-phase-list.tsx` — the **live board's**
  in-game phase panel (desktop pod `w-[248px]` panel AND the portrait bottom
  sheet), reached via `ControllerPhaseSheet`.
- `src/components/settings/settings-phase-stops-section.tsx` — this issue's
  new Settings page, added purely to preview/pre-set the same skip
  preferences outside a live game.

Resizing the dot gutters to hit 44px changes a **gameplay surface** (the
in-game phase sheet/panel) that issue #2595 never touched — it only added a
new consumer of the existing component. ADR 0101's own five-viewport receipt
requirement applies per surface touched; growing this component's geometry
would need its own five-viewport pass against the LIVE BOARD (stacked phase
list density, whether 14+ rows still fit the sheet's scroll budget, whether
the desktop pod's 248px width has room for 44px dots without wrapping/
squeezing the label) — not something to fold into a Settings-page slice as a
side effect.

**Arguing both sides.**

_For its own ticket:_ it is a real, currently-measured WCAG 2.5.8 miss on a
touch device, in the same family of defect (`Button size="sm"` inheriting the
dense `--control-h-sm` rung instead of the full `--control-h` one) this PR
just fixed two instances of elsewhere in the same component tree. Leaving it
open means the phase-stop toggles are the one remaining coarse-pointer miss
on a page whose whole point is coarse-pointer-safe preference editing — an
odd thing to ship next to a page that otherwise passes its own axe + touch
sweep clean. It is also cheap to reason about in isolation: `PhaseStopDot`
already receives `active`/`onClick`/`ariaLabel`/`tooltip` as props, so the
fix is plausibly confined to the two `h-6 w-6` gutter spans plus
`PhaseStopDot`'s own internal size, not a redesign.

_Against its own ticket (why it may not deserve one):_ it is pre-existing —
present on `main` before #2595 touched anything, not introduced by this
slice — and the component it lives in is gameplay chrome the touch-primitives
slice (`#2583`, cited by the `.filter-chip`/`.input-field` deferrals already
in `src/index.css`) is the more natural owner for, rather than a fresh
tracker. Growing a 24px dot to 44px inside a `w-[248px]` desktop panel row
that already carries a centered label plus two gutters may not fit without
widening the panel or dropping the label to two lines — exactly the kind of
tradeoff #2583's slice is scoped to work through with its own receipt, rather
than a one-line CSS bump discovered as a side observation here.

**Not a defect (recording so nobody re-finds it).** The option-row
`<input type="radio">` elements in `settings-density-section.tsx` /
`settings-motion-section.tsx` measure ~13px raw (the native radio control
itself), which looks like a second coarse-pointer miss at a glance — it is
not. The real interactive/tappable target is the surrounding `<label>` row
(`settings-option-group.tsx`), which measures 204×54 to 220×70px across the
five viewports — comfortably over 44px in both dimensions. The raw
`<input>` element's own box is not the touch target; the label wraps it.
