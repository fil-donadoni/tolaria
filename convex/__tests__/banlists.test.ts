import { describe, it, expect } from "vitest";
import {
    resolveBanlistDisplay,
    resolveBanlistEnforcementForFormat,
} from "../banlists";
import {
    BANLIST_SEEDS,
    PREMODERN_BANLIST_SEED,
    type BanlistEntry,
    type ResolveCardByName,
} from "../formats";

// Shared stub resolve across the describe blocks below: only "Built Card" is
// "registered", mirroring the acceptance criteria's canonical unbuilt-name
// case (e.g. Parallax Tide) — any other name is dropped, never thrown.
const stubResolve: ResolveCardByName = (name) =>
    name === "Built Card" ? { id: "built-id" } : null;

// Format banlist queries — pure cores (PRD #1138, issue #1141). The project
// has no convex-test harness (ADR-established pattern, see decks.test.ts /
// deckPresets.test.ts): `getBanlist` / `getBanlistEnforcement` are thin
// wrappers over `resolveBanlistDisplay` / `resolveBanlistEnforcementForFormat`
// — these tests exercise the cores directly, which is the query's entire
// behavior minus the DB read.

describe("resolveBanlistDisplay — DB rows or seed fallback (issue #1141)", () => {
    it("returns the DB rows verbatim when the format has any", () => {
        const rows: BanlistEntry[] = [
            { cardName: "Some Card", status: "banned" },
        ];
        const result = resolveBanlistDisplay("premodern", rows);
        expect(result).toEqual(rows);
    });

    it("falls back to the code-side seed when the format has no DB rows", () => {
        const result = resolveBanlistDisplay("premodern", []);
        expect(result).toEqual([...PREMODERN_BANLIST_SEED]);
        expect(result.length).toBeGreaterThan(0);
    });

    it("the seed fallback includes Parallax Tide (PRD #1138's canonical unbuilt-name example)", () => {
        const result = resolveBanlistDisplay("premodern", []);
        expect(result.some((e) => e.cardName === "Parallax Tide")).toBe(true);
    });

    it("old-school also falls back to a non-empty seed", () => {
        const result = resolveBanlistDisplay("old-school", []);
        expect(result.length).toBeGreaterThan(0);
        expect(result).toEqual([...BANLIST_SEEDS["old-school"]]);
    });

    it("does not mutate the seed constant it falls back to", () => {
        const before = [...PREMODERN_BANLIST_SEED];
        resolveBanlistDisplay("premodern", []).push({
            cardName: "Injected",
            status: "banned",
        } as never);
        expect([...PREMODERN_BANLIST_SEED]).toEqual(before);
    });
});

describe("resolveBanlistEnforcementForFormat — cardId sets from rows/seed (issue #1141)", () => {
    it("maps a built name to its cardId and drops an unbuilt one", () => {
        const rows: BanlistEntry[] = [
            { cardName: "Built Card", status: "banned" },
            { cardName: "Parallax Tide", status: "banned" },
        ];
        const { banned, restricted } = resolveBanlistEnforcementForFormat(
            "premodern",
            rows,
            stubResolve
        );
        expect(banned.has("built-id")).toBe(true);
        expect(banned.size).toBe(1);
        expect(restricted.size).toBe(0);
    });

    it("uses the seed fallback for enforcement too when the format has no DB rows", () => {
        // With no DB rows, enforcement falls back to the seed — same
        // selection `resolveBanlistDisplay` uses — resolved through `resolve`.
        // The stub never matches any seed name, so both sets stay empty
        // without throwing (the pure "drop, never crash" contract).
        const { banned, restricted } = resolveBanlistEnforcementForFormat(
            "premodern",
            [],
            stubResolve
        );
        expect(banned.size).toBe(0);
        expect(restricted.size).toBe(0);
    });
});

describe("getBanlist / getBanlistEnforcement — query shapes (issue #1141)", () => {
    it("getBanlist's shape is { cardName, status }[] (display, drops source/syncedAt)", () => {
        const rows: BanlistEntry[] = [
            { cardName: "Some Card", status: "restricted" },
        ];
        const result = resolveBanlistDisplay("old-school", rows);
        expect(result).toEqual([
            { cardName: "Some Card", status: "restricted" },
        ]);
        // no extra keys leak through (e.g. a caller accidentally passing a
        // full DB row with source/syncedAt)
        expect(Object.keys(result[0]).sort()).toEqual(["cardName", "status"]);
    });

    it("getBanlistEnforcement's shape is two disjoint cardId sets", () => {
        const rows: BanlistEntry[] = [
            { cardName: "Built Card", status: "banned" },
        ];
        const { banned, restricted } = resolveBanlistEnforcementForFormat(
            "premodern",
            rows,
            stubResolve
        );
        expect(banned).toBeInstanceOf(Set);
        expect(restricted).toBeInstanceOf(Set);
        for (const id of banned) expect(restricted.has(id)).toBe(false);
    });
});
