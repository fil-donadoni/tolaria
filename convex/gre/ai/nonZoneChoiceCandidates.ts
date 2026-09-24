/**
 * The candidates of a `PendingChoice` that are NOT members of a zone
 * (issue #2719).
 *
 * Most resolution choices pick cards: the candidate pool is a zone, read the
 * same way by every consumer. A handful pick something else — a PLAYER (CR
 * 115.4 / 115.1a), an abstract OPTION or trigger MODE (CR 614.12 / 603.3c), a
 * PILE label (ADR 0053), a trigger ORDER over stack items (CR 603.3b) — and for
 * those the zone read yields nothing, so each consumer has to append the real
 * candidates itself.
 *
 * That "each consumer appends them itself" is what this module ends. The live
 * bot (`src/lib/ai/bot-view.ts`, `buildOwedChoice`) had four such blocks; the
 * headless self-play harness (`src/lib/ai/selfplay/playGame.ts`) had its own
 * per-kind defaults instead — and `pick-pile` was in the first list and not the
 * second, so Fact or Fiction submitted an empty selection and every headless
 * game containing it died on "Select at least 1 card". Four of the fifteen
 * games in issue #2719's Tier 1 smoke matrix ended that way.
 *
 * One table, both consumers: a kind whose candidates are not zone members is
 * answerable everywhere or nowhere, never in live play only.
 *
 * Returns `[]` for an ordinary zone-backed kind — these ids are APPENDED to the
 * zone pool, never a replacement for it (`choose-damage-target` admits
 * creatures AND players).
 */

import type { PendingChoice } from "../state";
import type { PendingChoiceKind } from "../types";

/** The fields the table reads. Structural on purpose: the live bot sees the
 *  PROJECTED choice off the wire and the harness sees the fat one, and both
 *  carry these four. */
export type NonZoneChoiceHead = Pick<
    PendingChoice,
    "kind" | "options" | "candidateIds" | "candidatePlayerIds"
>;

/** ADR 0053 — the two pile labels a `pick-pile` answer names. Not instance ids:
 *  the piles themselves ride on `pileA` / `pileB`, and the submission names
 *  which one the chooser takes. */
export const PILE_LABELS = ["A", "B"] as const;

/** WHERE a kind's non-zone candidates come from. `"none"` is the ordinary
 *  case — the candidates are cards, and the zone read already found them. */
export type NonZoneCandidateSource =
    | "none"
    | "players"
    | "options"
    | "piles"
    | "candidateIds";

/**
 * Every `PendingChoiceKind`, and where its non-zone candidates come from.
 *
 * A `Record` over the union rather than a switch with a permissive `default`,
 * for the reason this module exists at all: the bug it fixes was a kind nobody
 * remembered to add to a list. A `default: return []` would let the NEXT such
 * kind fall silently onto the "it's just cards" side, which is exactly the
 * shape of `pick-pile`'s failure. Spelled out, `tsc` reds on a kind added to
 * the union until someone decides which side it is on — the same argument
 * `REASON_IS_FREEZE` makes in `scripts/lib/tier1-smoke.ts`.
 *
 * A kind that sets an explicit `zone` on its construction belongs on `"none"`
 * even when it also admits something else: `choose-damage-target` reads the
 * battlefield AND the player allow-list, so it is `"players"` and the ids are
 * APPENDED to the zone pool, never a replacement for it.
 */
export const NON_ZONE_CANDIDATE_SOURCE: Record<
    PendingChoiceKind,
    NonZoneCandidateSource
> = {
    // CR 115.4 (Cuombajj Witches) / CR 115.1a (Endurance) — players are legal
    // picks and are in no zone.
    "choose-damage-target": "players",
    "choose-player": "players",
    // CR 614.12 (Primal Clay) / CR 603.3c (a modal trigger's announced mode) —
    // an abstract option id. `options` already holds only the CHOOSABLE ones,
    // so every entry is a legal answer.
    "option-pick": "options",
    "trigger-mode": "options",
    // ADR 0053 — pile "A" or pile "B". Both labels are always offered: an EMPTY
    // pile is a legal split and a legal pick (an opponent dividing Fact or
    // Fiction's five cards may put all of them on one side), which is exactly
    // the case that used to reach the submit validator as a zero-card
    // selection.
    "pick-pile": "piles",
    // CR 603.3b (ADR 0058) — the ids are STACK ITEM ids to permute, not
    // permanents; collection order is a legal permutation.
    "trigger-order": "candidateIds",

    // --- Ordinary card picks: the zone read finds every candidate. ---
    "keep-permanents": "none",
    "sacrifice-permanents": "none",
    "keep-hand": "none",
    "search-library": "none",
    "pick-source": "none",
    "untap-pick": "none",
    "discard-hand": "none",
    "reorder-library": "none",
    "reveal-hand": "none",
    "choose-permanents": "none",
    partition: "none",
    "choose-hand-card": "none",
    "choose-graveyard-card": "none",
    "choose-exile-card": "none",
    "choose-library-card": "none",
    "draw-look-keep": "none",
    "order-top": "none",
    "look-distribute": "none",
    "choose-categorized": "none",
    "legend-keep": "none",
    "choose-aura-host": "none",
    // The DIVIDER's half of ADR 0053 — it splits real cards, so its candidates
    // are the zone's. Only the CHOOSER's half names a label.
    "divide-piles": "none",
    "mulligan-bottom": "none",
    // Answered through their own dedicated resolvers, never with instance ids
    // (`chooseResolution` throws on each): a yes/no, a scalar, a card name, an
    // acknowledgement.
    "may-pay": "none",
    "land-entry-tapped": "none",
    "draw-replacement": "none",
    "random-reveal": "none",
    "name-card": "none",
    "madness-cast": "none",
    "rebound-cast": "none",
    "number-pick": "none",
};

export function nonZoneChoiceCandidateIds(head: NonZoneChoiceHead): string[] {
    switch (NON_ZONE_CANDIDATE_SOURCE[head.kind]) {
        case "players":
            return [...(head.candidatePlayerIds ?? [])];
        case "options":
            return (head.options ?? []).map((o) => o.id);
        case "piles":
            return [...PILE_LABELS];
        case "candidateIds":
            return [...(head.candidateIds ?? [])];
        case "none":
            return [];
    }
}
