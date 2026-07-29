// Sagas (CR 714) — the engine-side half of the framework (ADR 0078). The
// card-side desugaring lives in `convex/cards/abilities/sagas.ts`; everything
// here reads the EFFECTIVE ability set, so chapter-ness travels through copy,
// grant and ability-loss suppression for free.
//
// The two CR 714 gates are BOTH "has at least one effective chapter ability",
// which is new in the 2026 rules and inverts the interaction most references
// still describe:
//
//   714.3c — "As a player's precombat main phase begins, that player puts a
//             lore counter on each Saga they control WITH ONE OR MORE CHAPTER
//             ABILITIES. This turn-based action doesn't use the stack."
//   714.4  — "If the number of lore counters on a Saga permanent WITH ONE OR
//             MORE CHAPTER ABILITIES is greater than or equal to its final
//             chapter number, and it isn't the source of a chapter ability
//             that has triggered but not yet left the stack, that Saga's
//             controller sacrifices it."
//
// Consequence, stated because it looks like a bug: a Saga under Blood Moon or
// Humility is NOT sacrificed. It loses its chapter abilities, so both gates
// stay shut — it keeps the lore counters it had, stops advancing, and persists
// inert. The pre-2026 rules had no gate, so `finalChapter` collapsed to 0,
// `lore >= 0` was trivially true, and the Saga died immediately (the famous
// "Blood Moon kills Urza's Saga" ruling). Do not "fix" this back.

import type { TriggeredAbility } from "../cards/types";
import { LORE_COUNTER, SAGA_SUBTYPE } from "../cards/abilities/sagas";
import { effectiveTriggeredAbilities } from "./copy";
import { addCounterToCard } from "./state";
import type { CardInstanceState, GameState, StackItem } from "./state";

export { LORE_COUNTER, SAGA_SUBTYPE };

/** CR 714.1 / ADR 0078 §4 — Saga identity is the SUBTYPE, never "has chapter
 *  abilities" (CR 714.2d contemplates a Saga with none). Layer 4 materializes
 *  subtypes onto `card.subtypes`, so this read is already post-layers. */
export function isSaga(card: CardInstanceState): boolean {
    return card.subtypes.includes(SAGA_SUBTYPE);
}

/** The chapter-tagged entries of a permanent's EFFECTIVE triggered abilities.
 *  Empty for a Saga whose abilities are suppressed (CR 613.1f) — which is what
 *  closes both CR 714 gates. */
export function effectiveChapterAbilities(
    card: CardInstanceState
): TriggeredAbility[] {
    return effectiveTriggeredAbilities(card).filter(
        (a) => a.chapterNumbers !== undefined && a.chapterNumbers.length > 0
    );
}

/** CR 714.2d — "the greatest value among the chapter numbers of the chapter
 *  abilities of that Saga". DERIVED, never declared: an author cannot write a
 *  final chapter that disagrees with the abilities. `0` when the Saga has no
 *  chapter abilities — a value both gates make unreachable, since each tests
 *  for at least one chapter ability first. */
export function finalChapter(card: CardInstanceState): number {
    let max = 0;
    for (const ability of effectiveChapterAbilities(card)) {
        for (const n of ability.chapterNumbers ?? []) {
            if (n > max) max = n;
        }
    }
    return max;
}

/** Lore counters currently on a permanent (CR 714.3). */
export function loreCounters(card: CardInstanceState): number {
    return card.counters?.[LORE_COUNTER] ?? 0;
}

/** Is this stack item a CHAPTER ability of `saga`? (CR 714.4's "the source of
 *  a chapter ability".)
 *
 *  Deliberately narrower than "any trigger sourced from this Saga": a granted
 *  trigger (`triggeredGrantTemplates`, e.g. Backup) sourced from the Saga must
 *  NOT defer the sacrifice for a turn. The chapter tag is what distinguishes
 *  them, which is the second reason the expander stamps `chapterNumbers` onto
 *  the ability (ADR 0078 §2). */
function isChapterAbilityOf(item: StackItem, saga: CardInstanceState): boolean {
    if (item.triggerSourceId !== saga.id) return false;
    if (!item.triggeredAbilityId) return false;
    return effectiveChapterAbilities(saga).some(
        (a) => a.id === item.triggeredAbilityId
    );
}

/** CR 714.4's stack clause. STACK-ONLY scan — no `pendingChapterTrigger`
 *  marker on the instance (ADR 0078 §5).
 *
 *  ORDERING DEPENDENCY, named on purpose: CR 714.4 says "has triggered but not
 *  yet left the stack" rather than "is on the stack" because strict CR 117.5
 *  ordering (SBAs, THEN put triggers on the stack) opens a window where the
 *  final chapter has triggered and is not yet stacked. Tolaria inverts that —
 *  `resolveTopOfStack` is resolve → `processPendingActionTriggers`, and every
 *  caller runs `checkStateBasedActions` afterwards — so a chapter that has
 *  triggered is ALWAYS already on the stack when this sweep reads it. If
 *  anyone ever reorders those two, a Saga would be sacrificed before its final
 *  chapter resolves; the regression test for exactly that lives in
 *  `convex/gre/__tests__/sagas.test.ts`. */
export function hasChapterAbilityOnStack(
    state: GameState,
    saga: CardInstanceState
): boolean {
    return state.stack.some((item) => isChapterAbilityOf(item, saga));
}

/** CR 714.3c — the turn-based action at the start of a player's precombat main
 *  phase. One lore counter on each Saga that player controls WITH ONE OR MORE
 *  CHAPTER ABILITIES. Does not use the stack; no player receives priority for
 *  it. Returns the ids that were countered (test/debug affordance). */
export function advanceSagasAtPrecombatMain(state: GameState): string[] {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active) return [];
    // Snapshot before mutating: `addCounterToCard` emits COUNTER_ADDED and
    // refreshes counter-gated statics, but never moves permanents, so a plain
    // copy of the battlefield keeps the iteration stable.
    const sagas = active.battlefield.filter(
        (c) => isSaga(c) && effectiveChapterAbilities(c).length > 0
    );
    for (const saga of sagas) addCounterToCard(state, saga, LORE_COUNTER, 1);
    return sagas.map((c) => c.id);
}
