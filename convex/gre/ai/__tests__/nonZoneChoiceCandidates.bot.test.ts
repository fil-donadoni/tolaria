/**
 * The one table of candidates that are not zone members (issue #2719).
 *
 * It exists because there used to be two: four inline blocks in the live bot's
 * `buildOwedChoice` and a separate set of per-kind defaults in the headless
 * self-play driver. `pick-pile` was in the first and in neither of the second,
 * so Fact or Fiction resolved fine against a human and killed every self-play
 * game it appeared in — four of the fifteen in the Tier 1 smoke matrix, all
 * with the same "Select at least 1 card" out of the submit validator, because
 * the harness had nothing to select.
 *
 * So what these assert is not arithmetic: it is that a kind whose candidates
 * are not cards still HAS candidates. An empty return here is the shape of the
 * bug.
 */

import { describe, it, expect } from "vitest";
import {
    nonZoneChoiceCandidateIds,
    PILE_LABELS,
    type NonZoneChoiceHead,
} from "../nonZoneChoiceCandidates";

function head(over: Partial<NonZoneChoiceHead>): NonZoneChoiceHead {
    return { kind: "choose-graveyard-card", ...over } as NonZoneChoiceHead;
}

describe("nonZoneChoiceCandidateIds", () => {
    it("ADR 0053 — offers BOTH pile labels, including the empty pile", () => {
        // The regression: an opponent dividing Fact or Fiction's five cards may
        // legally put all of them on one side, and taking the empty pile is a
        // legal answer. Nothing about the piles' contents narrows the labels.
        expect(nonZoneChoiceCandidateIds(head({ kind: "pick-pile" }))).toEqual([
            "A",
            "B",
        ]);
        expect([...PILE_LABELS]).toEqual(["A", "B"]);
    });

    it("CR 115.4 / CR 115.1a — a player pick offers the allow-listed players", () => {
        for (const kind of ["choose-damage-target", "choose-player"] as const) {
            expect(
                nonZoneChoiceCandidateIds(
                    head({ kind, candidatePlayerIds: ["p1", "p2"] })
                )
            ).toEqual(["p1", "p2"]);
        }
    });

    it("CR 614.12 / CR 603.3c — an option or trigger mode offers its option ids", () => {
        for (const kind of ["option-pick", "trigger-mode"] as const) {
            expect(
                nonZoneChoiceCandidateIds(
                    head({
                        kind,
                        options: [
                            { id: "o1", label: "First" },
                            { id: "o2", label: "Second" },
                        ],
                    })
                )
            ).toEqual(["o1", "o2"]);
        }
    });

    it("CR 603.3b — a trigger order offers the slice's stack item ids", () => {
        expect(
            nonZoneChoiceCandidateIds(
                head({ kind: "trigger-order", candidateIds: ["t1", "t2"] })
            )
        ).toEqual(["t1", "t2"]);
    });

    it("an ordinary zone-backed kind contributes nothing", () => {
        // These ids are APPENDED to the zone pool, never a replacement for it —
        // a card pick must not gain a phantom candidate.
        for (const kind of [
            "choose-graveyard-card",
            "discard-hand",
            "sacrifice",
        ] as const) {
            expect(
                nonZoneChoiceCandidateIds(
                    head({ kind, candidateIds: ["c1"], options: [] })
                )
            ).toEqual([]);
        }
    });

    it("a player pick with no allow-list yields nothing rather than throwing", () => {
        expect(
            nonZoneChoiceCandidateIds(head({ kind: "choose-player" }))
        ).toEqual([]);
    });
});
