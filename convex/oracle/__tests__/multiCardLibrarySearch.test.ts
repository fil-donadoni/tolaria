// "Search your library for <many> cards, …" — the multi-card library search
// (CR 701.23a, issue #5253). The accepted forms are golden fixtures
// (`grammar/fixtures.ts`, run by `goldenFixtures.test.ts`); this file pins the
// graduation they buy and the neighbours the rule must keep refusing:
//
//  1. GRADUATION — the exile and stack-on-top cards reach `ready` off their
//     real Oracle rows (CR 406.1, CR 205.2a, CR 107.3, CR 401.4).
//  2. LOWERING — "X cards" counts the announced X, and "in any order" keeps
//     the pick order (the `library-top` move preserves it, CR 401.4).
//  3. REFUSALS — Doomsday's two-zone search (no Op spans library and
//     graveyard), "X" with a stated quality, and "in any order" on one card.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return compileCard(oracleCard({ name, manaCost, typeLine, oracleText }));
}

describe("multi-card library search — graduation (CR 701.23a, CR 406.1)", () => {
    it.each([
        [
            "Mana Severance",
            "{1}{U}",
            "Search your library for any number of land cards, exile them, then shuffle.",
        ],
        [
            "Selective Memory",
            "{3}{U}",
            "Search your library for any number of nonland cards, exile them, then shuffle.",
        ],
        [
            "Manipulate Fate",
            "{1}{U}",
            "Search your library for three cards, exile them, then shuffle.\nDraw a card.",
        ],
    ])("%s compiles ready", (name, cost, text) => {
        expect(compile(name, cost, "Sorcery", text).state).toBe("ready");
    });

    it("Insidious Dreams compiles ready: X cards, shuffle, stack in order", () => {
        const outcome = compile(
            "Insidious Dreams",
            "{3}{B}",
            "Instant",
            "As an additional cost to cast this spell, discard X cards.\nSearch your library for X cards, then shuffle and put those cards on top in any order."
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.effects).toEqual([
            expect.objectContaining({
                op: "choice",
                kind: "search-library",
                count: { X: true },
                bind: "$found1",
            }),
            { op: "libraryLook", action: "shuffle", player: "controller" },
            expect.objectContaining({
                op: "moveZone",
                cards: { ref: "$found1" },
                from: "library",
                to: "library-top",
            }),
        ]);
    });

    it("a nonland search filter excludes the Land type (CR 205.2a)", () => {
        const outcome = compile(
            "Selective Memory",
            "{3}{U}",
            "Sorcery",
            "Search your library for any number of nonland cards, exile them, then shuffle."
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition.effects?.[0]).toMatchObject({
            filter: { excludeType: "Land" },
        });
    });
});

describe("multi-card library search — refusals (CR 701.23a)", () => {
    it("Doomsday's two-zone search stays unparsed: no Op spans library and graveyard", () => {
        const outcome = compile(
            "Doomsday",
            "{B}{B}{B}",
            "Sorcery",
            "Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order. You lose half your life, rounded up."
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("X with a stated quality is refused: it would be a range up to X", () => {
        const outcome = compile(
            "Probe",
            "{X}{G}",
            "Sorcery",
            "Search your library for X basic land cards, exile them, then shuffle."
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("X where the source announces none is refused (CR 107.3)", () => {
        const outcome = compile(
            "Probe",
            "{1}{U}",
            "Sorcery",
            "Search your library for X cards, exile them, then shuffle."
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('"in any order" on a single card is refused', () => {
        const outcome = compile(
            "Probe",
            "{1}{U}",
            "Instant",
            "Search your library for a creature card, reveal it, then shuffle and put it on top in any order."
        );
        expect(outcome.state).toBe("unparsed");
    });
});
