---
title: Forensic Gadgeteer's "whenever you cast an artifact spell" uses the scope that never fires on another spell
discoveredBy: 8652
status: draft
confidence: high
---

**What is wrong.** Forensic Gadgeteer declares `scope: "self"` on its
`spellCastTrigger` (`convex/cards/sets/mkm/blue.cards.ts:49`). `"self"` means the
spell being cast IS this source (`spellCastTrigger.ts`, `event.spellInstanceId ===
self.id`), and the card is not an artifact, so its filter refuses that one case
too. "Whenever you cast an artifact spell, investigate" is `scope: "you"`.

**Evidence.** Pinnacle Emissary first copied this shape in the issue #8652 pass:
the same `scope` + `filter: { types: "Artifact" }` gave no trigger on a hand-built
`SPELL_CAST` event, and `scope: "you"` gave one. A throwaway probe on the Gadgeteer
itself read 0 triggers too. `mkm/__tests__/blue.test.ts` tests only its cost
reduction, which is why nothing has caught it.

**Why it may not deserve its own issue.** It is a one-word fix on one card, but it
needs its own behaviour test, and a sweep for other "whenever you cast" cards on
`scope: "self"` found no second one by text search only; `gold.test.ts` cannot see
it while the card stays Hand Tail.
