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
    forcedCategorizedCover,
    isCategorizedCoverLegal,
    isCategorizedPickLegal,
    maxCategorizedPicks,
    minCategorizedCover,
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

// --- COVER rule (issue #1945, `chooseCategorized`) ------------------------
// The second, DIFFERENT legality rule over the same category buckets. The
// injective rule above answers "how many members can be kept, one per
// category"; the cover rule answers "which member does each category NOMINATE",
// where one member may answer SEVERAL categories at once (Planar Overlay's
// Gatherer ruling: "If you have a land which counts as multiple land types,
// you can choose that land as each of those types" — a dual land can be
// chosen as two of your land types; Noxious Vapors' multicoloured card is the
// same shape). A pick set is legal exactly when it COVERS every non-empty
// category and every member earns a distinct category (matching-saturated =
// no useless extra member).
describe("categorizedPick — cover rule (issue #1945)", () => {
    it("accepts a SINGLE member covering two categories at once (the dual-land ruling)", () => {
        // Plains + Tundra(Plains/Island): nominating the dual for BOTH the
        // Plains and the Island category is legal and returns only ONE land.
        const categories = cats({
            Plains: ["plains", "tundra"],
            Island: ["tundra"],
        });
        expect(isCategorizedCoverLegal(categories, ["tundra"])).toBe(true);
        // The two-land answer (plain Plains for Plains, dual for Island) is
        // equally legal — the player picks which.
        expect(isCategorizedCoverLegal(categories, ["plains", "tundra"])).toBe(
            true
        );
        // …but the plain Plains alone leaves "Island" unanswered.
        expect(isCategorizedCoverLegal(categories, ["plains"])).toBe(false);
        expect(isCategorizedCoverLegal(categories, [])).toBe(false);
    });

    it("rejects a member that earns no category of its own (unsaturated)", () => {
        const categories = cats({ Plains: ["p1", "p2"] });
        // Two Plains for ONE category: the second is a useless extra — no
        // assignment can seat both.
        expect(isCategorizedCoverLegal(categories, ["p1", "p2"])).toBe(false);
        expect(isCategorizedCoverLegal(categories, ["p1"])).toBe(true);
    });

    it("ignores EMPTY categories (a colour/type with no member at all)", () => {
        const categories = cats({ White: ["w"], Blue: [], Black: [] });
        expect(isCategorizedCoverLegal(categories, ["w"])).toBe(true);
        // Nothing matches anything at all — the empty pick IS the cover.
        expect(isCategorizedCoverLegal(cats({ White: [], Blue: [] }), [])).toBe(
            true
        );
    });

    it("rejects duplicate ids", () => {
        const categories = cats({ Plains: ["dual"], Island: ["dual"] });
        expect(isCategorizedCoverLegal(categories, ["dual", "dual"])).toBe(
            false
        );
    });

    it("minCategorizedCover is the size of the SMALLEST covering set, not the maximum matching", () => {
        // The dual answers both categories alone → 1, while the maximum
        // matching (`count.max`) is 2. Pinning `count.min` to the matching is
        // exactly the bug this rule exists to fix: it would FORCE the player
        // to return two lands.
        const categories = cats({
            Plains: ["plains", "tundra"],
            Island: ["tundra"],
        });
        expect(minCategorizedCover(categories)).toBe(1);
        expect(maxCategorizedPicks(categories)).toBe(2);
        // No member covers two colours here — the minimum is the full 2.
        const disjoint = cats({ White: ["w"], Blue: ["u"] });
        expect(minCategorizedCover(disjoint)).toBe(2);
        // Nothing matches → nothing to cover.
        expect(minCategorizedCover(cats({ White: [], Blue: [] }))).toBe(0);
    });

    it("a maximum-matching pick set is always a legal cover (so `count.max` is reachable)", () => {
        const categories = cats({
            Plains: ["plains", "tundra"],
            Island: ["tundra"],
            Swamp: [],
        });
        expect(isCategorizedCoverLegal(categories, ["plains", "tundra"])).toBe(
            true
        );
    });
});

// `forcedCategorizedCover` (issue #1945) — the "no real decision"
// auto-resolve case `chooseCategorized` uses (Noxious Vapors / Planar
// Overlay): every category names at most ONE candidate, so each non-empty
// category's nomination is forced. A candidate shared by two categories is
// still forced under the COVER rule (the same member answers both), unlike
// the injective rule where "which category claims it" would matter.
describe("categorizedPick — forced cover (issue #1945)", () => {
    it("returns the union of each category's single candidate when none overlap", () => {
        const categories = cats({
            Creature: ["bear"],
            Land: ["forest"],
            Instant: [],
        });
        expect(forcedCategorizedCover(categories)).toEqual(["bear", "forest"]);
    });

    it("returns an empty array when no category has any candidate", () => {
        const categories = cats({ Creature: [], Land: [] });
        expect(forcedCategorizedCover(categories)).toEqual([]);
    });

    it("refuses when a category has two OR MORE candidates (a real 'which one' decision)", () => {
        const categories = cats({ Creature: ["c1", "c2"], Land: ["forest"] });
        expect(forcedCategorizedCover(categories)).toBeUndefined();
    });

    it("DEDUPES a candidate shared by two single-candidate categories (still no decision)", () => {
        // A lone dual land: it must answer both Plains and Island, and only
        // that one land is returned. Nothing for the player to decide.
        const categories = cats({ Plains: ["dual"], Island: ["dual"] });
        expect(forcedCategorizedCover(categories)).toEqual(["dual"]);
    });

    it("agrees with isCategorizedCoverLegal whenever it returns a forced set", () => {
        const categories = cats({
            White: ["w"],
            Blue: ["u"],
            Black: [],
        });
        const forced = forcedCategorizedCover(categories);
        expect(forced).toBeDefined();
        expect(isCategorizedCoverLegal(categories, forced!)).toBe(true);
        expect(forced).toHaveLength(minCategorizedCover(categories));
    });
});
