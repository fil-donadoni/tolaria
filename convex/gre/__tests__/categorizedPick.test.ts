// Categorized-pick legality (issue #1364) — the shared matching that decides
// whether a `revealAndCategorize` keep-set is legal (CR 701.20a / 401.4).
//
// The whole point of the module is that GREEDY per-category assignment is
// UNSOUND: an artifact creature grabbed for "Creature" can strand a plain
// creature that had nowhere else to go, so a keep-set a smarter assignment
// could seat would be rejected. These tests pin the matching behaviour that
// the interpreter's `count.max`, the submit validation and the client's click
// gate all read.

import { describe, it, expect } from "vitest";
import {
    canAddCategorizedPick,
    categorizedEligibleIds,
    isCategorizedPickLegal,
    maxCategorizedPicks,
    type PickCategory,
} from "../categorizedPick";

/** Atraxa-shaped categories: one per card type, listing the revealed ids that
 *  have that type. A card with two types appears in two buckets. */
const cats = (entries: Record<string, string[]>): PickCategory[] =>
    Object.entries(entries).map(([label, cardIds]) => ({ label, cardIds }));

describe("categorizedPick — eligibility (issue #1364)", () => {
    it("collects every card appearing in at least one category, without duplicates", () => {
        const categories = cats({
            Creature: ["a", "b"],
            Artifact: ["b", "c"],
            Land: [],
        });
        expect(categorizedEligibleIds(categories)).toEqual(["a", "b", "c"]);
    });

    it("excludes a revealed card matching no category (it can only be bottomed)", () => {
        const categories = cats({ Creature: ["a"], Land: ["b"] });
        // "z" was revealed but is in no bucket — never hand-eligible.
        expect(categorizedEligibleIds(categories)).not.toContain("z");
        expect(isCategorizedPickLegal(categories, ["z"])).toBe(false);
    });
});

describe("categorizedPick — maximum matching (issue #1364)", () => {
    it("caps the keep at ONE when every revealed card shares a single category", () => {
        // Ten lands revealed under eight type categories: only the Land
        // category can be satisfied, so at most one card is keepable — the
        // exact case where offering "one per category" would be a pick that
        // cannot be made (CR 608.2b).
        const categories = cats({
            Creature: [],
            Land: ["a", "b", "c"],
            Instant: [],
        });
        expect(maxCategorizedPicks(categories)).toBe(1);
    });

    it("counts one per distinct satisfiable category", () => {
        const categories = cats({
            Creature: ["a"],
            Land: ["b"],
            Instant: ["c"],
        });
        expect(maxCategorizedPicks(categories)).toBe(3);
    });

    it("never double-counts a card that qualifies for several categories", () => {
        // "a" is an artifact creature — the ONLY card revealed. It fills either
        // Creature or Artifact, never both (Gatherer: a card with several card
        // types may be chosen for only one of them).
        const categories = cats({ Creature: ["a"], Artifact: ["a"] });
        expect(maxCategorizedPicks(categories)).toBe(1);
        expect(isCategorizedPickLegal(categories, ["a"])).toBe(true);
    });

    it("finds the augmenting path a greedy assignment would miss", () => {
        // "ac" is an artifact creature, "c" a plain creature. A greedy walk
        // that seats "ac" as Creature strands "c" and reports a max of 1; the
        // real answer is 2 (ac→Artifact, c→Creature).
        const categories = cats({
            Creature: ["ac", "c"],
            Artifact: ["ac"],
        });
        expect(maxCategorizedPicks(categories)).toBe(2);
        expect(isCategorizedPickLegal(categories, ["ac", "c"])).toBe(true);
    });
});

describe("categorizedPick — keep-set legality (issue #1364)", () => {
    const categories = cats({
        Creature: ["bear", "golemBear"],
        Artifact: ["golemBear", "sword"],
        Land: ["forest"],
    });

    it("accepts the empty set (the optional 'you may' keeps nothing)", () => {
        expect(isCategorizedPickLegal(categories, [])).toBe(true);
    });

    it("rejects two cards that can only be seated in the same category", () => {
        // Both "sword" and "golemBear" could take Artifact, but golemBear can
        // fall back to Creature — so this pair IS legal…
        expect(isCategorizedPickLegal(categories, ["sword", "golemBear"])).toBe(
            true
        );
        // …whereas two plain creatures are not (only one Creature seat).
        const twoCreatures = cats({ Creature: ["c1", "c2"], Land: [] });
        expect(isCategorizedPickLegal(twoCreatures, ["c1", "c2"])).toBe(false);
    });

    it("rejects a duplicated id (a card can be kept only once)", () => {
        expect(isCategorizedPickLegal(categories, ["bear", "bear"])).toBe(
            false
        );
    });

    it("accepts one card per distinct category", () => {
        expect(
            isCategorizedPickLegal(categories, ["bear", "sword", "forest"])
        ).toBe(true);
    });

    it("rejects a fourth card once all three categories are seated", () => {
        expect(
            isCategorizedPickLegal(categories, [
                "bear",
                "sword",
                "forest",
                "golemBear",
            ])
        ).toBe(false);
    });
});

describe("categorizedPick — incremental add (the client click gate, #1364)", () => {
    const categories = cats({
        Creature: ["bear", "wolf"],
        Land: ["forest"],
    });

    it("allows a card that opens a fresh category", () => {
        expect(canAddCategorizedPick(categories, ["bear"], "forest")).toBe(
            true
        );
    });

    it("refuses a second card whose only category is already taken", () => {
        expect(canAddCategorizedPick(categories, ["bear"], "wolf")).toBe(false);
    });

    it("refuses re-adding an already-picked card (that click deselects)", () => {
        expect(canAddCategorizedPick(categories, ["bear"], "bear")).toBe(false);
    });

    it("agrees with the submit-side legality check for every reachable set", () => {
        // The client gate and the server validator must never disagree — a
        // divergence either offers a pick the server rejects or hides a legal
        // one. Walk every subset and assert the two agree by construction.
        const ids = categorizedEligibleIds(categories);
        for (let mask = 0; mask < 1 << ids.length; mask++) {
            const picks = ids.filter((_, i) => mask & (1 << i));
            for (const id of ids) {
                if (picks.includes(id)) continue;
                expect(canAddCategorizedPick(categories, picks, id)).toBe(
                    isCategorizedPickLegal(categories, [...picks, id])
                );
            }
        }
    });
});
