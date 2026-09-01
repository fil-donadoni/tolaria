---
title: three citation families adjacent to the cast permission still read CR 601.3e, CR 117.6 or nothing that fits — left untouched by the #2972 pass
discoveredBy: 2972
status: draft
confidence: high
---

**What is wrong.** #2972 corrected the 142 sites where `CR 601.3e` was cited to
justify a CAST PERMISSION; the right rule there is plain `CR 601.3`. **38**
citations were deliberately left at `601.3e` because `601.3` is not their rule
either, in three families (19 + 13 + 6), and each is its own small correction:

**1. Casting-TIMING grants (19 sites).** `grantCastTiming` / `castTimingFlashGrant`
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

**2. Play-a-LAND-from-a-non-hand-zone permissions (13 sites).** `playLand.ts`
(7), `playsLandsFromGraveyard` / `playsLandsFromTopOfLibrary`
(`cards/types.ts`), `canPlayLandsFromTopOfLibrary` (`gre/rules.ts`), the
land-play source check in `game.ts:5855`, and `landEntryChoice.test.ts` (2).
`601.3` is
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

**Bonus 1 — `CR 117.6` rides along with many of the corrected sites, and the
replacement id is now known.** `bun run cr 117.6` prints "In a multiplayer game
using the shared team turns option, teams rather than individual players have
priority" — nothing to do with "you may cast it without paying its mana cost",
which is the claim it is attached to (Dauthi Voidwalker, Malcolm,
`withoutPayingManaCost`). The right id is **`CR 118.9`**, printed: "Alternative
costs are usually phrased, 'You may [action] rather than pay [this object's]
mana cost,' or **'You may cast [this object] without paying its mana cost.'**"
51 sites carry `117.6` today; 36 of them ride a line #2972 rewrote, so they now
read `CR 601.3 / 117.6` with a right first half and a wrong second one. They
were left alone deliberately: `117.6` is a family of its own (the other 15 sites
cite it for plain mana-payment arithmetic, `isManaCostCovered` /
`payManaCost` / the may-pay affordance), and fixing only the 36 that happen to
share a line with a cast permission would split one wrong citation into two
different states.

**Bonus 2 — `CR 601.3f` is more specific than `601.3` for the face-down impulse
casts.** "Some effects allow a player to cast a spell with certain qualities
from among face-down cards in exile. A player may begin to cast such a spell
only if they can look at the face-down card in exile." That is exactly Ice
Cauldron / Elkin Bottle / Dauthi Voidwalker / Robber of the Rich, all of which
exile FACE DOWN. `601.3` is not wrong at those sites — it is the general
permission — but `601.3f` carries the look-requirement the engine actually
enforces.

**Why it may not deserve its own issue.** Family 1 already has two drafts and is
mechanical once the 601.3b-vs-601.3d question is settled; families 2 and 3 and
the 117.6 bonus are small and unrelated to each other. This may be better as one
"CR citation audit outside the cast-permission family" ticket than four, which is
exactly the ticket #2972 declared out of scope.
