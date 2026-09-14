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

export function nonZoneChoiceCandidateIds(head: NonZoneChoiceHead): string[] {
    switch (head.kind) {
        // CR 115.4 (Cuombajj Witches) / CR 115.1a (Endurance) — players are
        // legal picks and are in no zone.
        case "choose-damage-target":
        case "choose-player":
            return [...(head.candidatePlayerIds ?? [])];
        // CR 614.12 (Primal Clay) / CR 603.3c (a modal trigger's announced
        // mode) — an abstract option id. `options` already holds only the
        // CHOOSABLE ones, so every entry is a legal answer.
        case "option-pick":
        case "trigger-mode":
            return (head.options ?? []).map((o) => o.id);
        // ADR 0053 — pile "A" or pile "B". Both labels are always offered: an
        // EMPTY pile is a legal split and a legal pick (an opponent dividing
        // Fact or Fiction's five cards may put all of them on one side), which
        // is exactly the case that used to reach the submit validator as a
        // zero-card selection.
        case "pick-pile":
            return [...PILE_LABELS];
        // CR 603.3b (ADR 0058) — the ids are STACK ITEM ids to permute, not
        // permanents; collection order is a legal permutation.
        case "trigger-order":
            return [...(head.candidateIds ?? [])];
        default:
            return [];
    }
}
