// The player-keyword verb frame (CR 611.2a): "You gain shroud until end of
// turn." and its hexproof siblings lower to `grantPlayerKeyword` on the
// controller.
//
//  1. GOLDEN — a real corpus card compiled whole: Gilded Light (shroud, beside
//     its Cycling line).
//  2. FORMS — plain hexproof, and "hexproof from A and from B" read as the two
//     abilities CR 702.11f says it is.
//  3. COMPOUND SUBJECT — "You and permanents you control gain …" (CR 611.2c):
//     the player's Ops plus one sweep granting the permanents each keyword.
//  4. REFUSALS — the neighbours the frame does not read: a longer duration, an
//     unnamed quality, another recipient.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const GILDED_LIGHT_TEXT =
    "You gain shroud until end of turn. (You can't be the target of spells or abilities.)\nCycling {2} ({2}, Discard this card: Draw a card.)";

function instant(oracleText: string) {
    return oracleCard({
        name: "Test Instant",
        manaCost: "{1}{W}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiledEffects(oracleText: string) {
    const outcome = compileCard(instant(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition.effects;
}

describe("player keyword frame — golden (CR 611.2a)", () => {
    it("spell slot: Gilded Light", () => {
        const card = oracleCard({
            oracleId: "f7e7b2aa-9fd2-41dd-b11e-3a233530dc83",
            name: "Gilded Light",
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText: GILDED_LIGHT_TEXT,
            power: undefined,
            toughness: undefined,
        });
        const outcome = compileCard(card);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                {
                    op: "grantPlayerKeyword",
                    player: "controller",
                    keyword: "shroud",
                },
            ])
        );
        expect(outcome.state).toBe("ready");
    });
});

describe("player keyword frame — forms (CR 702.11c / 702.11f)", () => {
    it("reads plain hexproof", () => {
        expect(compiledEffects("You gain hexproof until end of turn.")).toEqual(
            [
                {
                    op: "grantPlayerKeyword",
                    player: "controller",
                    keyword: "hexproof",
                },
            ]
        );
    });

    it('reads "hexproof from A and from B" as two abilities', () => {
        expect(
            compiledEffects(
                "You gain hexproof from blue and from black until end of turn."
            )
        ).toEqual([
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof from blue",
            },
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof from black",
            },
        ]);
    });
});

describe("player keyword frame — refusals", () => {
    it("refuses until your next turn (the Op ends at cleanup)", () => {
        expect(
            compileCard(instant("You gain hexproof until your next turn."))
                .state
        ).toBe("unparsed");
    });

    it("refuses a quality it cannot name", () => {
        expect(
            compileCard(
                instant("You gain hexproof from artifacts until end of turn.")
            ).state
        ).toBe("unparsed");
    });

    it("refuses another recipient", () => {
        expect(
            compileCard(
                instant("Target player gains shroud until end of turn.")
            ).state
        ).toBe("unparsed");
    });
});

describe("player keyword frame — compound subject (CR 611.2c)", () => {
    const sweep = (abilities: string[]) => ({
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            controller: "controller",
        },
        effects: abilities.map((ability) => ({
            op: "grantAbility",
            target: { ref: "$each" },
            ability,
            duration: { phase: "end-of-turn" },
        })),
    });

    it("reads plain hexproof for the player and the permanents", () => {
        expect(
            compiledEffects(
                "You and permanents you control gain hexproof until end of turn."
            )
        ).toEqual([
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof",
            },
            sweep(["hexproof"]),
        ]);
    });

    it('reads "hexproof from A and from B" as two abilities on each', () => {
        expect(
            compiledEffects(
                "You and permanents you control gain hexproof from white and from red until end of turn."
            )
        ).toEqual([
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof from white",
            },
            {
                op: "grantPlayerKeyword",
                player: "controller",
                keyword: "hexproof from red",
            },
            sweep(["hexproof from white", "hexproof from red"]),
        ]);
    });

    it("refuses shroud (no card prints it on the compound subject)", () => {
        expect(
            compileCard(
                instant(
                    "You and permanents you control gain shroud until end of turn."
                )
            ).state
        ).toBe("unparsed");
    });

    it("refuses another group beside the player", () => {
        expect(
            compileCard(
                instant(
                    "You and creatures you control gain hexproof until end of turn."
                )
            ).state
        ).toBe("unparsed");
    });
});
