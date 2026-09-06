---
title: mana-development's cast-invariance covers permanent spells only — a sorcery still pays 12 x MV for being cast
discoveredBy: 2928
status: draft
confidence: high
---

**What is wrong.** Issue #2928 fixed "the evaluator charges you for emptying
your hand" by counting the player's non-land permanents in the same demand the
hand feeds. That makes the term invariant across hand → battlefield. It is not
invariant across hand → **graveyard**, which is where instants and sorceries
go: casting Wrath of God (MV 4) with six lands still drops `manaDevelopment` by
`12 x 4 = 48`, exactly the toll #2928 was opened about, for roughly half a
catalogue. The header now says so plainly, but saying so is not fixing it.

**Evidence.** `convex/gre/evaluate.ts` — `manaDevelopmentTerm` raises demand
from `player.hand` and from the non-token, non-land permanents in
`player.battlefield`. Measured on the worktree for issue #2928: Wrath of God in
hand on 6 lands → term 48; after resolution → 0. The same shape appears at two
other zone boundaries the fix does not cross:

- a permanent LEAVING the battlefield takes its whole contribution with it — an
  8-MV artifact destroyed on eight lands costs 96 on top of the 99 the permanent
  itself was worth, and gaining CONTROL of an opponent's 8-drop swings the
  margin twice (the loop counts permanents you control, not ones you paid for);
- a **face-down** permanent has no mana cost (CR 708.2), so casting a shipped
  morph creature face down (Exalted Angel, `ons/white.ts`) moves it hand →
  battlefield and still drops the term by up to `12 x 6 = 72`, with `turn-face-up`
  refunding it for free. Reading the hidden identity back through `faceDownOf`
  would fix the number and leak hidden information into the opponent-side half
  of the same term, which is why it was not done in #2928.

**Why it may not deserve its own issue.** "A graveyard is continuing proof that
your mana base is earning its keep" is a genuinely different claim from the one
#2928 settled about the battlefield — the spell is gone, while the permanent is
still doing the thing the mana bought — so the right shape may be to bound the
board half (decay it, or floor it at what the hand alone asks) rather than to
extend it to more zones. Whichever way it goes, the removal-side magnitude is
inherited from `manaDevWeight` rather than measured, and no guard pins it.
