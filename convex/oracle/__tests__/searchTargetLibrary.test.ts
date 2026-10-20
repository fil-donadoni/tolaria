// "Search target player's library for <count> and exile them / put them into
// that player's graveyard[, then that player shuffles]." (CR 701.23a,
// CR 701.23b, CR 701.24a, issue #5252).
//
//  1. FORMS — the accepted sentences, compiled whole: the library owner is the
//     announced target, the chooser stays the controller, a plain count is
//     mandatory and "up to N" is the optional range.
//  2. REFUSALS — the neighbours this rule does not read: a stated quality
//     (Quiet Speculation's "with flashback"), an X count, a play-permission
//     continuation, a shuffle with no search before it.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Test Sorcery",
        manaCost: "{1}{U}",
        typeLine: "Sorcery",
        oracleText,
    });
}

function compiled(oracleText: string) {
    const outcome = compileCard(sorcery(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return sortKeys(outcome.definition) as {
        targetRequirement?: unknown;
        effects: Record<string, unknown>[];
    };
}

function refused(oracleText: string) {
    return compileCard(sorcery(oracleText)).state === "unparsed";
}

describe("Search a target library — accepted forms (CR 701.23a, CR 701.24a)", () => {
    it("plain count, exile, shuffle in the next sentence: a MANDATORY search", () => {
        const def = compiled(
            "Search target player's library for a card and exile it. Then that player shuffles."
        );
        expect(def.targetRequirement).toEqual({ type: "player", count: 1 });
        expect(def.effects).toEqual([
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                zoneOwnerId: { target: 0 },
                count: 1,
                prompt: "Search that player's library for a card.",
                bind: "$found1",
            },
            {
                op: "moveZone",
                cards: { ref: "$found1" },
                player: { target: 0 },
                from: "library",
                to: "exile",
            },
            { op: "libraryLook", action: "shuffle", player: { target: 0 } },
        ]);
    });

    it("up to N, exile, shuffle inside the sentence: the optional range", () => {
        const def = compiled(
            "Search target player's library for up to three cards, exile them, then that player shuffles."
        );
        expect(def.effects[0]).toMatchObject({
            zoneOwnerId: { target: 0 },
            count: { min: 0, max: 3 },
        });
        expect(def.effects[1]).toMatchObject({ to: "exile" });
        expect(def.effects[2]).toMatchObject({ action: "shuffle" });
    });

    it("a spelled count with no shuffle printed: no shuffle emitted", () => {
        const def = compiled(
            "Search target player's library for seven cards and exile them."
        );
        expect(def.effects).toHaveLength(2);
        expect(def.effects[0]).toMatchObject({ count: 7 });
    });

    it("target opponent narrows the announced player", () => {
        const def = compiled(
            "Search target opponent's library for a card and exile it."
        );
        expect(def.targetRequirement).toEqual({
            type: "player",
            count: 1,
            controller: "opponent",
        });
    });

    it("the graveyard route moves the find to that player's graveyard (CR 404.1)", () => {
        const def = compiled(
            "Search target player's library for up to two cards and put them into that player's graveyard."
        );
        expect(def.effects[1]).toMatchObject({
            op: "moveZone",
            from: "library",
            to: "graveyard",
            player: { target: 0 },
        });
    });
});

describe("Search a target library — refusals (CR 701.23b)", () => {
    it.each([
        [
            "a stated quality",
            "Search target player's library for up to three cards with flashback and put them into that player's graveyard.",
        ],
        [
            "an X count",
            "Search target player's library for X cards, where X is the number of cards in your hand, and exile them.",
        ],
        [
            "a play-permission continuation",
            "Search target opponent's library for a card and exile it face down. You may look at and cast that card.",
        ],
        [
            "a pronoun that disagrees with the count",
            "Search target player's library for three cards and exile it.",
        ],
        [
            "a graveyard that is not the player's",
            "Search target player's library for a card and put it into your graveyard.",
        ],
        [
            "a shuffle with no search before it",
            "Draw a card. Then that player shuffles.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(refused(text)).toBe(true);
    });
});
