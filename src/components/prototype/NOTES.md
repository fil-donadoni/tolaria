# Prototype — attachment cluster (throwaway)

**Question.** A permanent can hold MULTIPLE attached satellites — auras stacked
on one creature, or creatures held in exile by one permanent (Parallax Wave).
Today only the topmost is visible:

- Exile: `board-battlefield-card.tsx:271` pins every `ExiledAssociatedCard` at
  the SAME fixed `-top-[26%] -left-[26%]` → total overlap, only the last paints.
- Auras: `board-battlefield.tsx:203` cascades each aura `-22%*(i+1)` → heavy
  overlap, each aura shows only a corner.

Desired: a horizontal fan (like the identical-permanent fan) + click opens a
graveyard-style pile dialog showing all satellites.

**Run.** Dev server (`bun run dev`) → `http://localhost:5173/prototype/attachments`.
Flip variants with the floating bar or ← / →.

**Variants.**

- **A — Corner fan.** Reuses the `battlefield-stack-fan` language: satellites
  fan out of the top-left, overlap, hover-lift, ×N badge. Covers part of host art.
- **B — Bottom tray shelf.** Host art untouched; satellites as slim slivers on a
  shelf docked to the bottom edge, kind-coloured spine (violet aura / amber exile).
- **C — Collapsed proxy pile.** One mini-card + paper layers + ×N + kind dots;
  leans entirely on the dialog. Most compact.

All three share `AttachmentPileDialog` = the real `CardsPile` in controlled mode.

**Verdict.** _(TBD — pick a variant / a hybrid, then fold the winner into
`board-battlefield-card.tsx` (exile) + `renderHostWithAuras` in
`board-battlefield.tsx` (auras) and delete this dir + the `/prototype/attachments`
route.)_
