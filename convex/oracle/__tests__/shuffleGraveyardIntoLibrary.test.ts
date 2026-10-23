// "Shuffle your graveyard into your library." (CR 701.24a, CR 404.1).
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const CLAUSE =
    "When this card is put into your graveyard from your library, shuffle your graveyard into your library.";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Gaea's Blessing",
        manaCost: "{1}{G}",
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("Shuffle graveyard into library — (CR 701.24a, CR 404.1)", () => {
    it("lowers to a whole-zone moveZone then a shuffle at a milled-self head", () => {
        const outcome = compileCard(sorcery(`Draw a card.\n${CLAUSE}`));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const { compiledTriggeredAbilities } = outcome.definition as {
            compiledTriggeredAbilities: { effects: unknown[] }[];
        };
        const trig = compiledTriggeredAbilities[0]!;
        expect(sortKeys(trig.effects)).toEqual(
            sortKeys([
                {
                    op: "moveZone",
                    player: "controller",
                    from: "graveyard",
                    to: "library",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ])
        );
    });

    it("refuses the targeted-player neighbour", () => {
        const outcome = compileCard(
            sorcery(
                "When this card is put into your graveyard from your library, target player shuffles their graveyard into their library."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
