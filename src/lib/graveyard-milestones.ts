import type { CardInstance } from "~/types/game";

// Live progress indicators for the two graveyard-threshold ability words that
// gate a card's oracle text on the controller's graveyard state:
//
//   - Delirium (CR 702.D)  — active with four or more card TYPES among cards
//                            in your graveyard.
//   - Threshold (CR 702.T) — active with seven or more CARDS in your graveyard.
//
// Both are ability words (CR 207.2c): they carry no rules meaning themselves,
// they only prefix a reminder-style clause in the oracle text. We surface the
// controller's current progress toward each milestone next to that word in the
// live card preview, so the player can read at a glance whether the conditional
// clause is currently on.

export type Milestone = {
    /** The ability word as printed, used to match the oracle-text occurrence. */
    word: "Delirium" | "Threshold";
    /** Current value for this player (distinct types, or card count). */
    have: number;
    /** Value required for the ability to be active. */
    need: number;
    /** Whether the milestone is currently reached (`have >= need`). */
    met: boolean;
};

const DELIRIUM_NEED = 4; // CR 702.D — four or more card types in your graveyard
const THRESHOLD_NEED = 7; // CR 702.T — seven or more cards in your graveyard

/** Distinct card TYPES among the cards in a graveyard (CR 702.D — delirium).
 *  Mirrors the server-side count in `gre/effects/interpreter.ts` (a `Set` over
 *  each card's `types`) so the live UI value matches the resolved outcome. */
export function countGraveyardTypes(graveyard: CardInstance[]): number {
    const typeSet = new Set<string>();
    for (const c of graveyard) {
        for (const t of c.types ?? []) typeSet.add(t);
    }
    return typeSet.size;
}

/** Builds the milestone lookup for a graveyard, keyed by the lowercased ability
 *  word so a text scan can resolve a matched occurrence to its progress. */
export function computeGraveyardMilestones(
    graveyard: CardInstance[]
): Map<string, Milestone> {
    const types = countGraveyardTypes(graveyard);
    const cards = graveyard.length;
    return new Map<string, Milestone>([
        [
            "delirium",
            {
                word: "Delirium",
                have: types,
                need: DELIRIUM_NEED,
                met: types >= DELIRIUM_NEED,
            },
        ],
        [
            "threshold",
            {
                word: "Threshold",
                have: cards,
                need: THRESHOLD_NEED,
                met: cards >= THRESHOLD_NEED,
            },
        ],
    ]);
}

/** Regex SOURCE for the ability words that carry a live graveyard-progress chip
 *  — the capitalized ability word only (never lowercase reminder text). Kept as
 *  a string, not a shared `RegExp` instance: a stateful global with a mutable
 *  `lastIndex` cannot be scanned from inside a React component (React Compiler
 *  immutability). Consumers build a fresh `RegExp` per scan. */
export const MILESTONE_WORD_SOURCE = "\\b(Delirium|Threshold)\\b";

/** True when a paragraph contains a milestone ability word worth annotating. */
export function hasMilestoneWord(text: string): boolean {
    return new RegExp(MILESTONE_WORD_SOURCE).test(text);
}
