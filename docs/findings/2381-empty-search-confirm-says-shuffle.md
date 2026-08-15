---
title: The zero-pick library-search confirm button always says "Shuffle", even for searches that never shuffle
discoveredBy: 2381
status: draft
confidence: low
---

**What is wrong.** The library-search confirm button hardcodes its `max === 0`
label to `"Shuffle"`, on the assumption that a no-hit search is always followed
by a shuffle. That assumption is a property of the CARD's own text ("then
shuffle"), not of the picker. Doomsday (this issue) reaches the same component with `count: { min: 0,
max: 0 }` when the library is empty, and it never shuffles anything — so the
chooser is offered a button naming an action the card does not perform.

**Evidence.** `src/components/board/library-search-confirm.tsx:25-27` — the
label ternary is `max === 0 ? "Shuffle" : min === 0 && selected === 0 ? "Skip" :
…`, with no input from the effect that raised the choice. The `PendingChoice`
carries a `prompt` but nothing the button could key the verb off.

**Why it may not deserve its own issue.** Purely cosmetic — the button submits
the same empty pick whatever it says, and today exactly one card reaches the
label with no shuffle behind it. The clean fix (thread the post-search verb, or
just an explicit label, through the choice) is a small seam change but touches a
shared component and its wire shape; the cheap fix (fall back to "Done" unless
the choice declares a shuffle) is a one-liner. Either way it is a line on a UI
polish tracker rather than its own ticket unless more cards land in the same
shape.
