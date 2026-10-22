# /bot-audit — the seams a theme crosses

Reached from `SKILL.md` step 2. A theme is `Decision Class × mechanic family`
(ADR 0149 §1); the class says which seams the DECISION passes through, the
family says which terms and probes must READ the mechanic for the decision to
come out right. Open every seam of the class, then every seam the family
names, and write one "does not read" line per suspicion.

Every path below is a file in this repository; every symbol is exported or
named in that file's header. A path that no longer exists is a drift this
file must follow, not a reason to guess.

## Seams by Decision Class

The class is the `Move` kind that answers the question
(`CLASS_OF_MOVE_KIND`, `convex/gre/ai/verdicts/coverage.ts`).

| Class                                    | Enumeration (is the move offered?)                                                                                         | Evaluation (can the term see it?)                                                                                                                                                                                                                                                                                                                                                                   | Announcement (does it want to?)                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `land-drop`                              | `play-land` in `enumerateMoves` (`convex/gre/moves.ts`); the `land-entry-tapped` choice (`convex/gre/applyMove.ts`)        | `mana`, `manaDevelopment`, `colorCoverage`, `flexibility` terms (`convex/gre/evaluate.ts`; `convex/gre/ai/colorCoverage.ts`)                                                                                                                                                                                                                                                                        | `convex/gre/ai/interchangeable.ts` (copies collapse), `convex/gre/ai/deferral.ts` (which window)                                                                    |
| `cast`                                   | `cast-spell` in `enumerateMoves`; the `passPriority` mirror in `convex/gre/search.ts` (responding at all)                  | `hand` + `handLatentLens`, `flexibility`, `evaluateBreakdown` after `applyMoveForSearch` (`convex/gre/applyMove.ts`)                                                                                                                                                                                                                                                                                | `OP_VALUERS` / `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`), `convex/gre/ai/cardScriptValue.ts`, `aiEffects` shadows, `convex/gre/ai/dominance.ts` (no-op prune) |
| `activate`                               | the battlefield / hand / graveyard scans of `enumerateMoves` (`activateFromHand`, `activateFromGraveyard`)                 | the same terms as `cast`, plus `convex/gre/ai/abilityTiming.ts` (instant-speed discipline)                                                                                                                                                                                                                                                                                                          | the `*Exchange.ts` prunes (`convex/gre/ai/`: draw, discard, drain, denial, removal), `convex/gre/ai/futileShield.ts`, `convex/gre/ai/sourceConfinedBenefit.ts`      |
| `declare-attackers`                      | attacker subsets, exert variants, per-planeswalker redirect (`MAX_COMBINATIONS` cap) in `enumerateMoves`                   | `declaredCombatDelta`, `lethalUnblockedDelta` (`convex/gre/evaluate.ts`); `convex/gre/creatureBody.ts` keyword table; `convex/gre/ai/keywordRelevance.ts`; `convex/gre/ai/restrictionPricing.ts`                                                                                                                                                                                                    | the combat tie-breaks of `selectRootMove` (`convex/gre/search.ts`)                                                                                                  |
| `declare-blockers`                       | blocker assignments in `enumerateMoves` (blocker minimums and caps)                                                        | `declaredBlockDelta`, the lethal-damage reader (CR 510.4 first strike, CR 702.2c deathtouch; `convex/gre/evaluate.ts`); `convex/gre/ai/blockDominance.ts`; `convex/gre/ai/damageSplit.ts`                                                                                                                                                                                                           | `convex/gre/ai/blade/damageSplitProbe.ts` (what the split probe reads)                                                                                              |
| `targeting`                              | `getLegalTargets` (`convex/gre/rules.ts`); `submit-target` Move; `convex/gre/ai/choiceCandidates.ts` + `choicePriors.ts`   | `convex/gre/ai/latentBoard.ts` (best legal target), `convex/gre/ai/representativeVictim.ts` (typed victim when no board says)                                                                                                                                                                                                                                                                       | `convex/gre/ai/beneficence.ts` (per-target sign: who does this announcement help?)                                                                                  |
| `resolution-choice` / `optional-payment` | `CHOICE_CANDIDATE_GENERATORS` (`convex/gre/ai/choiceCandidates.ts`), `convex/gre/ai/nonZoneChoiceCandidates.ts`, `may-pay` | `convex/gre/ai/candidateValue.ts`, `convex/gre/ai/choiceDepth.ts` (resolving on a clone)                                                                                                                                                                                                                                                                                                            | `convex/gre/ai/choicePriors.ts` (top-K opening)                                                                                                                     |
| `mulligan`                               | `mulligan` / `mulligan-bottom` Moves (`convex/gre/moves.ts`)                                                               | `hand`, `manaDevelopment`, `colorCoverage` terms                                                                                                                                                                                                                                                                                                                                                    | the bottoming candidates (`convex/gre/ai/choiceCandidates.ts`)                                                                                                      |
| `pass` with a non-empty Stack            | the `passPriority` mirror and `applyMoveForSearch`'s resolution (`convex/gre/search.ts`, `convex/gre/applyMove.ts`)        | no `EvalTerms` KEY is a Stack term; the Stack is read by `etbAbilitiesInFlight` (into `creatures`) and `activationsInFlight` (into `flexibility`) in `convex/gre/evaluate.ts`, and by `isQuietFor` (`convex/gre/ai/defensiveGrants.ts`: any opponent item on the Stack ends the quiet). None prices what an item's TARGET is worth before a rollout resolves it — measure that before suspecting it | `convex/gre/ai/abilityTiming.ts`, `convex/gre/ai/deferral.ts` (last window), `convex/gre/ai/botReachStack.ts` (what a stack position contains)                      |

## Probes — factors already modelled one module over

Open these BEFORE suspecting a factor absent: half of what looks blind in
`evaluate.ts` is read here. Each is a leaf module in `convex/gre/ai/` with a
header stating the class it prices.

| Factor                                      | Module                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| hold an instant-speed activation            | `abilityTiming.ts`, `deferral.ts`                                                                      |
| a resolution that changes nothing           | `dominance.ts`                                                                                         |
| a shield that can never be used             | `futileShield.ts`                                                                                      |
| a multi-block that only feeds the attacker  | `blockDominance.ts`                                                                                    |
| how an attacker divides damage              | `damageSplit.ts`                                                                                       |
| what removal in hand is worth on THIS board | `latentBoard.ts`, `representativeVictim.ts`                                                            |
| a keyword that does nothing on this board   | `keywordRelevance.ts` (landwalk, protection ONLY)                                                      |
| a defensive grant with nothing to fear      | `defensiveGrants.ts`                                                                                   |
| can't attack / block / untap statics        | `restrictionPricing.ts`                                                                                |
| loyalty as a resource                       | `loyaltyValue.ts`                                                                                      |
| a library card lost now                     | `decking.ts`                                                                                           |
| a card in the graveyard                     | `graveyardReach.ts`                                                                                    |
| colours the base can produce / has shown    | `colorCoverage.ts`, `observedColors.ts`                                                                |
| what a search would fetch                   | `searchDestination.ts`                                                                                 |
| a cost that gives up a permanent            | `drawExchange.ts`, `discardExchange.ts`, `drainExchange.ts`, `denialExchange.ts`, `removalExchange.ts` |
| two copies of one card                      | `interchangeable.ts`                                                                                   |
| a position already stood on                 | `repetition.ts`                                                                                        |

## Seed themes

The owner's five questions (PRD issue #4920 § Further Notes) and the census's
collection targets, each mapped onto its theme and read through to a concrete
seam list. Each heading is the theme's key in `AUDIT_THEMES`
(`convex/gre/ai/blade/auditThemes.ts`), verbatim.

### `cast × blink`

Question: "does it blink its own creature to save it from removal, or the
opponent's creature before combat to stop lethal?" → `cast` × blink.

- `OP_BENEFICENCE` (`convex/gre/ai/opValuers.ts`): a blink script is
  `exile` + `moveZone` back through a `bind` (the "blink primitive" in the
  `exile` Op's registry note). `exile` reads `"harmful"`, `moveZone`
  `"neutral"`: the announcement reads as harm to its target, so a blink aimed
  at the Bot's own creature is a self-harm by sign unless the return nets it.
  `exileAndReturnTransformed` is the one blink-shaped sign that reads
  `"beneficial"`.
- `OP_VALUERS.exile` and `convex/gre/ai/cardScriptValue.ts`: does the
  script's value net the exile against the return, or price the blink as
  removal? Does it read the ETB the return replays (`botReachBlink.ts` says a
  blink is worth that trigger; `effectOpChildren.ts` is the walk)?
- The SAVE case needs the opponent's removal on the Stack: the Stack readers (§ Seams by class, `pass`) see it as an item in flight and as the end of `isQuietFor`'s quiet, not as a removal aimed at THIS creature — measure whether the leaf prices the threat before a rollout resolves it; `convex/gre/ai/botReachStack.ts` shapes such a position; the `passPriority` mirror in `convex/gre/search.ts`
  is where the Bot gets to respond at all.
- `flexibility` (`convex/gre/evaluate.ts`), `convex/gre/ai/abilityTiming.ts`,
  `convex/gre/ai/deferral.ts`: is an instant-speed blink HELD for the last
  window, and is "a removal spell on the Stack" a last window?
- The COMBAT case: blinking an attacking creature removes it from combat (CR
  506.4); `declaredCombatDelta` / `lethalUnblockedDelta`
  (`convex/gre/evaluate.ts`) read the declared attack — a `step` Discriminant
  (before vs after attackers are declared).

### `land-drop × enters-tapped`

Question: "does it play the tapped land in the turn it would not have used
the mana anyway?" → `land-drop` × enters-tapped.

- The `mana` term (`manaSourceTermFor`, `convex/gre/evaluate.ts`): counts EVERY source, a tapped one at `tappedManaWeight` (`convex/gre/ai/evalWeights.ts`), a premium of about 1.5 points below `manaWeight` — flat, whatever the hand holds. So the untapped land wins by that premium on an idle turn exactly as on a live one. The right-hand half is the same board with a spell in hand the open mana casts now (`card` Discriminant).
- `manaDevelopmentTerm` (`convex/gre/evaluate.ts`): reads the base with
  `ignoreTapState: true` — both lands develop the same; `colorCoverage.ts`
  likewise reads colours the base can supply, tapped or not. Neither distinguishes the two drops; the `mana` premium and `flexibility` do.
- `play-land` in `enumerateMoves` (`convex/gre/moves.ts`): one move per land;
  `convex/gre/ai/interchangeable.ts` collapses copies — a tapped and an
  untapped land are not copies, so both are offered.
- The `land-entry-tapped` choice (shock lands: `convex/gre/applyMove.ts`,
  `convex/gre/legalActions.ts`): `life` against `mana` — a `life`
  Discriminant pair (pay 2 at 20 life vs at 3).
- `flexibility` (`flexibilityTerm`, `convex/gre/evaluate.ts`, off the same available-mana census): the OPTION to act this turn — an untapped drop raises it only while a castable instant is held, zero otherwise. It is the term that tells an idle turn from a live one, so the pair holds the instant on both sides or on neither, never only on one.
- `convex/gre/ai/deferral.ts`: is the land drop deferrable to the postcombat
  main, and does the `sequence` Discriminant (land before vs after the draw
  spell) leave a trace the Evaluation reads?

### `declare-attackers|declare-blockers × first-strike/double-strike/deathtouch`

Question: "does it read first strike, double strike and deathtouch when it
attacks or blocks?" → `declare-attackers` | `declare-blockers` × those three.

- The lethal-damage reader of `convex/gre/evaluate.ts` (the block above
  `lethalUnblockedDelta`: CR 510.4 first strike, CR 702.2c deathtouch,
  `lethalDamageThreshold` shared with `phases.ts`) and `declaredBlockDelta` /
  `declaredCombatDelta`: the exchange is priced here — compare its result to
  what `convex/gre/combat.ts` actually resolves on the same board.
- `convex/gre/creatureBody.ts` keyword table: `"first strike"` 5 + 4·power,
  `deathtouch` 20 + 2·power, `"double strike"` 5 + 14·power — body worth by
  the creature's OWN power, board-blind; `convex/gre/ai/keywordRelevance.ts`
  makes landwalk and protection board-aware and NOTHING else — so a first
  striker facing only bigger-toughness blockers, or a deathtoucher facing no
  creature, is priced as if the keyword bit.
- `convex/gre/ai/blockDominance.ts`: dominated multi-blocks resolve damage
  through the real pipeline (first strike, deathtouch included) — the one
  seam that reads the keywords exactly; check it is reached for the single
  block too.
- `convex/gre/ai/damageSplit.ts` + `convex/gre/ai/blade/damageSplitProbe.ts`:
  a deathtouch attacker's split (1 is lethal to each blocker, CR 702.2c).
- The combat tie-breaks of `selectRootMove` (`convex/gre/search.ts`, "this
  tie-break is the seam the term was measured") — where an outcome-equal
  attack and pass are settled.
- `enumerateMoves` attacker / blocker enumeration (`convex/gre/moves.ts`):
  the right block must be in the capped set (`MAX_COMBINATIONS`).

### `declare-attackers × planeswalker`

Question: "does it prefer killing a planeswalker over hitting the player?" →
`declare-attackers` × planeswalker.

- `enumerateMoves` (`convex/gre/moves.ts`, CR 508.1b, the planeswalker loop):
  per defending planeswalker ONE variant per attacker subset directs the WHOLE
  declaration at it (`attackTargets` maps every attacker → that walker). A
  split — two at the walker, one at the face — is never enumerated: an
  enumeration suspicion before any valuation one.
- `convex/gre/evaluate.ts`: an attacker aimed at a planeswalker never reaches
  the life (CR 508.1b), and its trample overflow goes to the walker, not the
  player (CR 702.19b);
  `permanentRealisedValue` prices the walker through
  `convex/gre/ai/loyaltyValue.ts` (a RATIO of the walker's worth by its
  loyalty range) — so the question is whether `declaredCombatDelta` credits
  loyalty removed as a gain the way it credits life removed.
- `lethalUnblockedDelta` (`convex/gre/evaluate.ts`): lethal to the PLAYER
  only — a walker about to die by combat is not a terminal-scale read.
- `declaredBlockDelta` on the defender's side: does the defender of a
  planeswalker block to save it?
- The `life` Discriminant: at 20 life kill the walker, at 4 hit the face.

### `cast × counterspell-as-cycler`

Question: "does it see that a late-game Miscalculation is a cycler, not a
counter?" → `cast` × counterspell-as-cycler (the cycling is an `activate`
from hand; the theme sits in `cast` because the decision is what the card IS
on this board).

- The hand scan of `enumerateMoves` (`convex/gre/moves.ts`, CR 702.29a):
  `activateFromHand` abilities are enumerated from the hand — confirm the
  cycling Move is in the list at all before suspecting its value.
- `OP_BENEFICENCE.counter` reads `"harmful"`; the `counter` row of `OP_VALUERS` prices it as `"disruption"` with the `targeted` tag (`convex/gre/ai/opValuers.ts`) — a flat price that never reads whether a spell worth countering can still come. Name what prices the cycling half (`draw` reads `"beneficial"`), and whether `convex/gre/ai/cardScriptValue.ts` nets the two.
- `flexibility` and `hand` + `handLatentLens` (`convex/gre/evaluate.ts`): a
  held counterspell with open mana is option value priced FLAT — the term
  never reads that the opponent's hand is empty, or that the library is short
  (`convex/gre/ai/decking.ts`): the late-game `card` / `other` Discriminant.
- `convex/gre/ai/abilityTiming.ts` + `convex/gre/ai/deferral.ts`: cycling at
  sorcery speed vs holding — the "last window" for a card whose counter half
  will never fire.
- `convex/gre/ai/drawExchange.ts`: the below-the-root prune for an activation
  whose cost gives up a permanent and draws — read whether a cycling cost
  (discard this card) is in its class, or outside it.

### Census targets

The corpus census's collection targets
(`docs/research/verdict-corpus-coverage.md`), each its own theme — take one
when the owner brings no question (SKILL.md step 0):

- `any × non-empty-stack` — § Seams by class, `pass`: the three Stack readers and what they do not price; `botReachStack.ts`; `abilityTiming.ts`, `deferral.ts`; the
  `passPriority` mirror.
- `declare-blockers × combat` — `declaredBlockDelta`, `blockDominance.ts`,
  `damageSplit.ts`, `lethalUnblockedDelta`, `restrictionPricing.ts` (can't
  block), the blocker enumeration.
- `declare-attackers × combat` — `declaredCombatDelta`, `keywordRelevance.ts`,
  `restrictionPricing.ts` (can't attack), the exert variants and the
  `MAX_COMBINATIONS` cap, the `selectRootMove` tie-breaks.
- `targeting × any` — `getLegalTargets`, `beneficence.ts`, `latentBoard.ts`,
  `representativeVictim.ts`, `choiceCandidates.ts` + `choicePriors.ts`,
  `interchangeable.ts`.
- `mulligan × any` — the `mulligan` / `mulligan-bottom` Moves, `hand`,
  `manaDevelopment`, `colorCoverage.ts`, the bottoming candidates.
