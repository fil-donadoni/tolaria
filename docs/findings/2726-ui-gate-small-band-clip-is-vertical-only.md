---
title: the ui-gate `small` probe clips its band vertically only, so a horizontal scroller reports every off-screen control and the ceiling becomes a deck count
discoveredBy: 2726
status: draft
confidence: high
---

**What is wrong.** `probe.js`'s touch-target scan skips a control that is above
or below the viewport, but not one that is left or right of it:

```js
if (r.bottom < 0 || r.top > H) continue;
if (Math.min(r.width, r.height) < 44) small.push(…);
```

Every other measurement in the file is careful about exactly this — `probe()`
hit-tests the centre of the element's visible intersection with (viewport n its
own scroll port) precisely so that a control a gesture away is not confused with
one on screen. `small` has no port clip and no horizontal clip at all.

While the app's scrollers were vertical this cost nothing: a control scrolled
out of a vertical list also left the band. It stops being free the moment a
surface scrolls horizontally.

**Evidence.** Issue #2726 replaced the lobby's vertical deck LIST (a 28rem
capped scroller) with two horizontally scrolling Deck Shelves, one tile per
deck, each tile carrying one `DeckRowMenu` "⋯" trigger. Browser-measured at
`1440x900x2` on `feat/issue-2726`:

- 61 triggers counted in `small`, spanning x `904 -> 7704`;
- exactly **8** of them fall inside the 1440px viewport. The other **53** are
  off to the right and need a scroll gesture, the same condition that scores
  `reachable` (not `occ`) everywhere else in the probe.

The `lobby` `1440x900x2` `small` ceiling therefore had to be recorded at 83, of
which 61 is "how many decks does the ui-gate account hold" — the row now moves
whenever anyone adds or deletes a deck on the shared deployment. That is the
same disease `2822-lobby-limited-strip-data-dependent.md` records for the
Limited re-entry strip on this very row, at roughly six times the size.

**Why it may not deserve its own issue.** The fix is one condition
(`|| r.right < 0 || r.left > V`, or better, the `scrollPort` clip the rest of
the file already computes), but it re-measures **every** surface in
`budgets.json` at once and would lower an unknown number of ceilings in a single
commit. Deciding whether that is a tightening pass worth taking — and whether
`small` should instead mean "targets a user can currently reach", which is a
different and arguably better metric than "targets that exist" — is a lane-design
question for #2580's owner, not something a surface-level PR should settle by
changing the shared probe to make its own row smaller.

There is also a real argument for the current behaviour: a tap target is too
small whether or not it is scrolled into view, and counting only what is on
screen would let a surface hide debt by scrolling. If that is the ruling, the
honest consequence is that any horizontally scrolling collection makes its
surface's `small` ceiling a function of the account's data, and the budget file
should say so as a rule rather than per row.
