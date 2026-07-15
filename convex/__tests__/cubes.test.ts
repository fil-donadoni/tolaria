import { describe, it, expect } from "vitest";
import { resolveCubeMembership } from "../cubes";
import type { ResolveCardByName } from "../formats";

// Cube membership — pure core. The project has no convex-test harness
// (ADR-established pattern, see banlists.test.ts / decks.test.ts): the
// `list` / `membership` queries are thin wrappers over `resolveCubeMembership`,
// so these tests exercise the core directly — the query's entire behavior
// minus the DB read.

// Stub registry: only these two names are "built"; every other name is
// unbuilt (dropped), mirroring the real case where most of a 540-card cube
// worklist has no CardDefinition yet.
const stubResolve: ResolveCardByName = (name) => {
    if (name === "Black Lotus") return { id: "lotus-id" };
    if (name === "Sol Ring") return { id: "solring-id" };
    return null;
};

describe("resolveCubeMembership — names → built cardIds", () => {
    it("resolves built names to their canonical cardIds", () => {
        expect(
            resolveCubeMembership(["Black Lotus", "Sol Ring"], stubResolve)
        ).toEqual(["lotus-id", "solring-id"]);
    });

    it("drops unbuilt names rather than throwing", () => {
        expect(
            resolveCubeMembership(
                ["Black Lotus", "Ancestral Recall", "Sol Ring"],
                stubResolve
            )
        ).toEqual(["lotus-id", "solring-id"]);
    });

    it("dedups repeated names / names collapsing to one card", () => {
        expect(
            resolveCubeMembership(["Black Lotus", "Black Lotus"], stubResolve)
        ).toEqual(["lotus-id"]);
    });

    it("is order-stable on first appearance", () => {
        expect(
            resolveCubeMembership(["Sol Ring", "Black Lotus"], stubResolve)
        ).toEqual(["solring-id", "lotus-id"]);
    });

    it("returns [] for an empty cube", () => {
        expect(resolveCubeMembership([], stubResolve)).toEqual([]);
    });

    it("returns [] when no name is built", () => {
        expect(
            resolveCubeMembership(["Nonexistent", "Also Missing"], stubResolve)
        ).toEqual([]);
    });
});
