// Issue #3341 — the clause forms Urza, Lord Protector and its combined back face
// print: one golden per accepted form, one refusal per neighbour, so fail-closed
// is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { compileCard } from "../compile";
import { goldOracleCard } from "../gold";
import type { OracleCard } from "../types";

function card(
    typeLine: string,
    oracleText: string,
    extra: Partial<OracleCard> = {}
): OracleCard {
    return {
        oracleId: "00000000-0000-4000-8000-000000000001",
        name: "Quiet Keeper",
        manaCost: "{2}",
        typeLine,
        oracleText,
        layout: "normal",
        legalIn: [],
        ...extra,
    } as OracleCard;
}

const artifact = (text: string) => card("Artifact", text);
const walker = (text: string) =>
    card("Legendary Planeswalker — Urza", text, { loyalty: "7", manaCost: "" });

function compiled(c: OracleCard) {
    const outcome = compileCard(c);
    if (outcome.state === "unparsed")
        throw new Error(`refused: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

describe("CR 601.2f — a cost modifier over a list of three card types", () => {
    it('reads the serial comma of "Artifact, instant, and sorcery spells"', () => {
        expect(
            compiled(
                artifact(
                    "Artifact, instant, and sorcery spells you cast cost {1} less to cast."
                )
            ).compiledStaticEffects
        ).toEqual([
            {
                kind: "cost-modifier",
                spells: {
                    types: ["Artifact", "Instant", "Sorcery"],
                    controller: "you",
                },
                reduction: 1,
            },
        ]);
    });

    it("refuses a bare comma with no conjunction", () => {
        expect(
            compileCard(
                artifact(
                    "Artifact, instant spells you cast cost {1} less to cast."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe('CR 601.2f — "<spells> you cast this turn cost {N} less to cast"', () => {
    it("lowers to the floating reduction, the Op's `player` saying whose", () => {
        expect(
            compiled(
                walker(
                    "+2: Artifact, instant, and sorcery spells you cast this turn cost {2} less to cast. You gain 2 life."
                )
            ).activatedAbilities?.[0].effects
        ).toEqual([
            {
                op: "reduceSpellCostThisTurn",
                player: "controller",
                amount: { X: 2 },
                filter: { types: ["Artifact", "Instant", "Sorcery"] },
            },
            { op: "gainLife", player: "controller", amount: 2 },
        ]);
    });

    it("refuses the tax direction, which the Op cannot say", () => {
        expect(
            compileCard(
                walker(
                    "+2: Artifact spells you cast this turn cost {2} more to cast."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe('CR 613.1f — "<group> gain <keyword> until end of turn"', () => {
    it("lowers to `grantAbility` over a sweep of the group", () => {
        expect(
            compiled(
                walker(
                    "-10: Artifacts and planeswalkers you control gain indestructible until end of turn."
                )
            ).activatedAbilities?.[0].effects
        ).toEqual([
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: ["Artifact", "Planeswalker"] },
                },
                effects: [
                    {
                        op: "grantAbility",
                        target: { ref: "$each" },
                        ability: "indestructible",
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
    });

    it("refuses a word that is no keyword, and a group with no controller", () => {
        expect(
            compileCard(
                walker(
                    "-10: Creatures you control gain bravery until end of turn."
                )
            ).state
        ).toBe("unparsed");
        expect(
            compileCard(walker("-10: Creatures gain flying until end of turn."))
                .state
        ).toBe("unparsed");
    });
});

describe("CR 606.3 — the loyalty activation allowance", () => {
    it("reads the source's own allowance as one extra activation", () => {
        expect(
            compiled(
                walker(
                    "You may activate the loyalty abilities of Quiet Keeper twice each turn rather than only once."
                )
            ).compiledStaticEffects
        ).toEqual([{ kind: "loyalty-activation-allowance", extra: 1 }]);
    });

    it("refuses a class of permanents, another scope", () => {
        expect(
            compileCard(
                walker(
                    "You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("Urza, Lord Protector is the compiler's output, art aside", () => {
    it("compiles from its own text to its own abilities and combined face", () => {
        const urza = getCardByName("Urza, Lord Protector");
        const definition = compiled(goldOracleCard(urza));
        expect(urza.activatedAbilities).toEqual(definition.activatedAbilities);
        const { activatedAbilities, ...face } = urza.backFace!;
        delete face.imagePrintId;
        delete face.colors;
        const { activatedAbilities: compiledAbilities, ...compiledFace } =
            definition.backFace!;
        expect(face).toEqual(compiledFace);
        // The Soldier token's edition art is pinned by hand; nothing else differs.
        expect(
            JSON.parse(
                JSON.stringify(activatedAbilities).replaceAll(
                    ',"imagePrintId":"37da5b54-ec55-46e3-9f0b-565cbbe1ac7a"',
                    ""
                )
            )
        ).toEqual(compiledAbilities);
    });
});
