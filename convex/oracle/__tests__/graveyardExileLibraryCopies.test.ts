// "Exile all cards from target player's graveyard other than basic land cards.
// For each card exiled this way, search that player's library for all cards
// with the same name as that card and exile them. Then that player shuffles."
// (CR 205.4a, CR 608.2c, CR 701.23a, CR 701.24a): the three sentences fold
// into one `forEach` over the graveyard. Goldens and fail-closed refusals.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const FIRST =
    "Exile all cards from target player's graveyard other than basic land cards.";
const SECOND =
    "For each card exiled this way, search that player's library for all cards with the same name as that card and exile them.";
const THIRD = "Then that player shuffles.";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Echo Probe",
        manaCost: "{3}{B}{B}",
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

const NOT_A_BASIC_LAND = {
    any: [{ excludeType: "Land" }, { excludeSupertype: "Basic" }],
};

describe("graveyard exile + same-name library sweep (CR 608.2c, CR 701.23a)", () => {
    it("compiles Haunting Echoes to one forEach and one shuffle", () => {
        const outcome = compileCard(sorcery(`${FIRST} ${SECOND} ${THIRD}`));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: { target: 0 },
                        filter: NOT_A_BASIC_LAND,
                    },
                    effects: [
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            fromZones: ["graveyard"],
                            filter: {
                                name: { ref: "$each.name" },
                                ...NOT_A_BASIC_LAND,
                            },
                            to: "exile",
                        },
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            fromZones: ["library"],
                            filter: { name: { ref: "$each.name" } },
                            to: "exile",
                        },
                    ],
                },
                { op: "libraryLook", action: "shuffle", player: { target: 0 } },
            ])
        );
    });

    it("reads the graveyard sentence alone as a filtered sweep", () => {
        const outcome = compileCard(sorcery(FIRST));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "moveZone",
                    player: { target: 0 },
                    fromZones: ["graveyard"],
                    filter: NOT_A_BASIC_LAND,
                    to: "exile",
                },
            ])
        );
    });

    it("refuses the library sweep with no graveyard exile before it", () => {
        expect(compileCard(sorcery(SECOND)).state).toBe("unparsed");
    });

    it("refuses the library sweep behind a plain graveyard exile", () => {
        expect(
            compileCard(sorcery("Exile target player's graveyard. " + SECOND))
                .state
        ).toBe("unparsed");
    });

    it("refuses a second shuffle", () => {
        expect(
            compileCard(sorcery(`${FIRST} ${SECOND} ${THIRD} ${THIRD}`)).state
        ).toBe("unparsed");
    });
});
