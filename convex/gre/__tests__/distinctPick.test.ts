// Pairwise-distinct pick legality (CR 701.23a, issue #6475) — the leaf
// predicate behind `choice { kind: "search-library", distinctBy }`.

import { describe, it, expect } from "vitest";
import {
    canAddDistinctPick,
    distinctEligibleIds,
    isDistinctPickLegal,
    maxDistinctPicks,
} from "../distinctPick";

const byName = {
    f1: "Forest",
    f2: "Forest",
    i1: "Island",
    s1: "Swamp",
};

describe("distinctPick (CR 701.23a)", () => {
    it("CR 701.23a — a set with no shared key is legal", () => {
        expect(isDistinctPickLegal(byName, ["f1", "i1", "s1"])).toBe(true);
    });

    it("CR 701.23a — two cards sharing a name are rejected", () => {
        expect(isDistinctPickLegal(byName, ["f1", "f2"])).toBe(false);
    });

    it("CR 701.23a — works for any key, e.g. power", () => {
        const byPower = { a: "2", b: "2", c: "3" };
        expect(isDistinctPickLegal(byPower, ["a", "c"])).toBe(true);
        expect(isDistinctPickLegal(byPower, ["a", "b"])).toBe(false);
    });

    it("CR 701.23b — a pick of fewer than `count`, even none, is legal", () => {
        expect(isDistinctPickLegal(byName, ["i1"])).toBe(true);
        expect(isDistinctPickLegal(byName, [])).toBe(true);
    });

    it("CR 208.3 — a card with no key (no power) is not pickable", () => {
        const withNoPower = { creature: "2" };
        expect(isDistinctPickLegal(withNoPower, ["land"])).toBe(false);
        expect(distinctEligibleIds(withNoPower)).toEqual(["creature"]);
    });

    it("a duplicated id is rejected", () => {
        expect(isDistinctPickLegal(byName, ["i1", "i1"])).toBe(false);
    });

    it("CR 701.23b — the reachable maximum is the number of distinct keys, below `count`", () => {
        expect(maxDistinctPicks(byName)).toBe(3);
        expect(maxDistinctPicks({})).toBe(0);
    });

    it("canAddDistinctPick refuses a repeated key and an already-picked card", () => {
        expect(canAddDistinctPick(byName, ["f1"], "f2")).toBe(false);
        expect(canAddDistinctPick(byName, ["f1"], "i1")).toBe(true);
        expect(canAddDistinctPick(byName, ["f1"], "f1")).toBe(false);
    });
});
