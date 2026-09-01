---
title: three citation families adjacent to the cast permission still read CR 601.3e, CR 117.6 or nothing that fits — left untouched by the #2972 pass
discoveredBy: 2972
status: draft
confidence: high
---

**What is wrong.** #2972 corrected the 141 sites where `CR 601.3e` was cited to
justify a CAST PERMISSION; the right rule there is plain `CR 601.3`. Three
families were deliberately left at `601.3e` because `601.3` is not their rule
either, and each is its own small correction:

**1. Casting-TIMING grants (17 sites).** `grantCastTiming` / `castTimingFlashGrant`
(Teferi, Time Raveler's +1 — "you may cast sorcery spells as though they had
flash") cite `601.3e`. The rule that licenses a granted flash window is
`CR 601.3b` ("If an effect allows a player to cast a spell with certain
qualities as though it had flash…") together with `601.3d`. Sites:
`gre/state.ts` (the `castTimingFlashGrants` field and `grantCastTiming`),
`gre/phases.ts`, `gre/effects/interpreter.ts`, `gre/effects/validate.ts`,
`gre/effects/scenarioGenerator.ts`, `cards/mechanicsRegistry.ts` (the Op's own
`cr:` field), `cards/castRestrictions.ts`, `cards/types.ts`,
`cards/sets/war/multicolor.ts` and the two test files. Already drafted twice
from the other direction: `2146-flash-grant-cites-601-3e.md` and
`2392-teferi-flash-grant-cites-601-3e.md` — this is the same family, now the
ONLY remaining `601.3e` block of any size.

**2. Play-a-LAND-from-a-non-hand-zone permissions (13 sites).** `playLand.ts`,
`playsLandsFromGraveyard` / `playsLandsFromTopOfLibrary` (`cards/types.ts`),
`canPlayLandsFromTopOfLibrary` (`gre/rules.ts`), the land half of the
projection's `topLegalActions`, and `landEntryChoice.test.ts`. `601.3` is
explicitly about casting a SPELL, so it cannot replace `601.3e` here — a land is
played, never cast (`CR 305.9`, already cited alongside at several of these
sites). What the right citation is deserves one deliberate decision rather than
a sweep: `CR 305.1` grants the special action, but the _permission to play from
a zone other than the hand_ has no single obvious id in the current numbering.

**3. Six comments whose CLAIM is wrong, not just the id.** `601.3e` is cited for
things that have nothing to do with casting at all: an "of an opponent's choice"
target (`drk/white.ts`), a "you MAY put" optional pick (`drk/green.ts`), a
"may pay {X}" gate and a "X = the creature's mana value" line
(`ice/colorless.ts` ×2 and its test), and "You may exile a nonland card from
your hand" (`ice/colorless.ts`). Per #2972's own scope note these are noted, not
edited: each needs its real rule looked up, which is per-site work, not a sweep.

**Bonus — `CR 117.6` rides along with many of the corrected sites.**
`bun run cr 117.6` prints "In a multiplayer game using the shared team turns
option, teams rather than individual players have priority" — nothing to do with
"you may cast it without paying its mana cost", which is the claim it is attached
to (Dauthi Voidwalker, Malcolm, `withoutPayingManaCost`). The rule for a waived
mana cost is in the `CR 118` block. Roughly 20 sites, several of them now reading
`CR 601.3 / 117.6`, where the first half is right and the second is not.

**Why it may not deserve its own issue.** Family 1 already has two drafts and is
mechanical once the 601.3b-vs-601.3d question is settled; families 2 and 3 and
the 117.6 bonus are small and unrelated to each other. This may be better as one
"CR citation audit outside the cast-permission family" ticket than four, which is
exactly the ticket #2972 declared out of scope.
