// The per-controller tail of a removal (CR 608.2c, CR 608.2h, CR 701.23h):
// "For each creature exiled this way, its controller searches their library
// for a basic land card. Those players put those cards onto the battlefield
// tapped, then shuffle." (`grammar/shared/actedOnControllers.ts`).
//
//  1. GOLDEN — Winds of Abandon compiled whole: the exile binds what it moved
//     inside the overload sweep, and one `forEach` over the players runs the
//     search chain for each player who lost a creature, for up to as many
//     basic lands as they lost.
//  2. GOLD — the hand-written Winds round-trips.
//  3. REFUSALS — either sentence alone, a removal other than an exile, a
//     verb or noun the head does not read, a count per object, a "may".

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
import { oracleCard } from "./oracle.fixture";

const EXILE = "Exile target creature you don't control.";
const SEARCH =
    "For each creature exiled this way, its controller searches their library for a basic land card.";
const PUT =
    "Those players put those cards onto the battlefield tapped, then shuffle.";
const OVERLOAD =
    '\nOverload {4}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")';

function sorcery(body: string) {
    return oracleCard({
        oracleId: "499a4715-6776-461b-bee4-22ed172d455e",
        name: "Winds of Abandon",
        manaCost: "{1}{W}",
        oracleText: `${body}${OVERLOAD}`,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

const LOST = {
    boundCount: { of: { ref: "$exiled2" }, controller: { ref: "$each" } },
};

describe("per-controller search after an exile (CR 608.2c, CR 701.23h)", () => {
    it("compiles Winds of Abandon to the exile sweep and one per-player search", () => {
        const outcome = compileCard(sorcery(`${EXILE} ${SEARCH} ${PUT}`));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Winds of Abandon",
                types: ["Sorcery"],
                manaCost: { X: 1, W: 1 },
                oracleText: `${EXILE} ${SEARCH} ${PUT}${OVERLOAD}`,
                overload: {
                    id: "overload",
                    description: "Overload {4}{W}{W}",
                    mana: { X: 4, W: 2 },
                },
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "opponent",
                },
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets" },
                        effects: [
                            {
                                op: "exile",
                                target: { ref: "$each" },
                                bind: "$exiled2",
                            },
                        ],
                    },
                    {
                        op: "forEach",
                        select: { set: "players" },
                        effects: [
                            {
                                op: "if",
                                predicate: { left: LOST, op: "ge", right: 1 },
                                then: [
                                    {
                                        op: "choice",
                                        kind: "search-library",
                                        player: { ref: "$each" },
                                        zone: "library",
                                        filter: {
                                            type: "Land",
                                            supertype: "Basic",
                                        },
                                        count: { min: 0, max: LOST },
                                        prompt: "Search your library for a basic land card for each of your creatures exiled this way.",
                                        bind: "$found1",
                                    },
                                    {
                                        op: "moveZone",
                                        cards: { ref: "$found1" },
                                        player: { ref: "$each" },
                                        from: "library",
                                        to: "battlefield",
                                        tapped: true,
                                    },
                                    {
                                        op: "libraryLook",
                                        action: "shuffle",
                                        player: { ref: "$each" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("gold: the hand-written Winds of Abandon round-trips", () => {
        const raw = getAllRawCards().find((c) => c.name === "Winds of Abandon");
        expect(raw).toBeDefined();
        expect(roundTripCard(raw!).verdict).toEqual({
            ok: true,
            kind: "equal",
        });
    });
});

describe("per-controller search — refusals", () => {
    const unparsed = (body: string) =>
        expect(compileCard(sorcery(body)).state).toBe("unparsed");

    it("refuses the search sentence with no sentence putting the find anywhere", () =>
        unparsed(`${EXILE} ${SEARCH}`));

    it('refuses "Those players …" with no search before it', () =>
        unparsed(`${EXILE} ${PUT}`));

    it("refuses the tail after a removal that is not an exile", () =>
        unparsed(
            `Destroy target creature you don't control. ${SEARCH} ${PUT}`
        ));

    it("refuses a verb the head does not read", () =>
        unparsed(`${EXILE} ${SEARCH.replace("exiled", "destroyed")} ${PUT}`));

    it("refuses a noun the head does not read", () =>
        unparsed(
            `Exile target permanent you don't control. ${SEARCH.replace("creature", "permanent")} ${PUT}`
        ));

    it("refuses a find of more than one card per object", () =>
        unparsed(
            `${EXILE} ${SEARCH.replace("a basic land card", "two basic land cards")} ${PUT}`
        ));

    it('refuses an optional search ("may search")', () =>
        unparsed(
            `${EXILE} ${SEARCH.replace("searches", "may search")} ${PUT}`
        ));

    it('refuses a "Those players" chain that moves nothing', () =>
        unparsed(`${EXILE} ${SEARCH} Those players shuffle.`));
});
