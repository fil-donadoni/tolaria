// Threshold and graveyard conditions (issue #4551).
//
// Two rules, each pinned by a golden over a real corpus card, its refused
// neighbours, and the engine behaviour the compiled descriptor stands for:
//
//  1. "Threshold — This creature gets +N/+N as long as there are seven or more
//     cards in your graveyard" — CR 611.3a / 613.4c, the permanent's own
//     layer-7c buff gated on a count over its controller's graveyard (CR 404.1;
//     Threshold itself is an ability word, CR 207.2c).
//  2. "At the beginning of your upkeep, if this card is in your graveyard, …" —
//     CR 113.6b, the ability functions from the graveyard: the printed
//     intervening-if IS the ability's zone.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { conditionRule } from "../grammar/shared/condition";
import { oracleCard, parseContext } from "./oracle.fixture";

function creature(
    name: string,
    manaCost: string,
    subtypes: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        typeLine: `Creature — ${subtypes}`,
        oracleText,
        power: "1",
        toughness: "1",
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    if (outcome.state !== "ready")
        throw new Error(`${card.name} is ${outcome.state}`);
    return outcome.definition;
}

const NIMBLE_MONGOOSE = creature(
    "Nimble Mongoose",
    "{G}",
    "Mongoose",
    "Shroud\nThreshold — This creature gets +2/+2 as long as there are seven or more cards in your graveyard."
);

const WEREBEAR = creature(
    "Werebear",
    "{1}{G}",
    "Bear Druid",
    "{T}: Add {G}.\nThreshold — This creature gets +3/+3 as long as there are seven or more cards in your graveyard."
);

describe("Threshold self pump — golden fixtures (CR 611.3a, CR 613.4c)", () => {
    it("Nimble Mongoose: a keyword line, then the gated pump", () => {
        expect(sortKeys(compiled(NIMBLE_MONGOOSE))).toEqual(
            sortKeys({
                name: "Nimble Mongoose",
                types: ["Creature"],
                subtypes: ["Mongoose"],
                manaCost: { G: 1 },
                power: 1,
                toughness: 1,
                oracleText: NIMBLE_MONGOOSE.oracleText,
                staticAbilities: ["shroud"],
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "self",
                        power: 2,
                        toughness: 2,
                        condition: { kind: "graveyard-count", atLeast: 7 },
                    },
                ],
            })
        );
    });

    it("Werebear: the pump reads beside a mana ability", () => {
        expect(compiled(WEREBEAR).compiledStaticEffects).toEqual([
            {
                kind: "pt-buff",
                appliesTo: "self",
                power: 3,
                toughness: 3,
                condition: { kind: "graveyard-count", atLeast: 7 },
            },
        ]);
    });
});

describe("Threshold self pump — refused neighbours (fail-closed)", () => {
    const refused = (text: string) =>
        compileCard(creature("Probe", "{G}", "Mongoose", text)).state;

    it.each([
        [
            "a count other than a number word",
            "Threshold — This creature gets +2/+2 as long as there are 7 or more cards in your graveyard.",
        ],
        [
            "a different zone",
            "Threshold — This creature gets +2/+2 as long as there are seven or more cards in your library.",
        ],
        [
            "an opponent's graveyard",
            "This creature gets +2/+2 as long as there are seven or more cards in an opponent's graveyard.",
        ],
        [
            "the ability word in front of a controls clause",
            "Threshold — This creature gets +2/+2 as long as you control a Forest.",
        ],
        [
            "a subject that is not the permanent itself",
            "Threshold — Wolves gets +2/+2 as long as there are seven or more cards in your graveyard.",
        ],
        [
            "a threshold of one (not a count anyone prints)",
            "This creature gets +2/+2 as long as there are one or more cards in your graveyard.",
        ],
    ])("%s", (_form, text) => {
        expect(refused(text)).toBe("unparsed");
    });
});

describe("Threshold self pump in the layer system", () => {
    const def = compiled(NIMBLE_MONGOOSE);
    const card = { ...def, id: "compiled-mongoose-4551" };

    function board(graveyardSize: number, who: "p1" | "p2" = "p1") {
        const mongoose = makeInstance(card.id, { id: "mongoose" });
        const filler = Array.from({ length: graveyardSize }, (_, i) =>
            makeInstance(card.id, { id: `gy-${i}` })
        );
        return {
            mongoose,
            state: makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [mongoose],
                        graveyard: who === "p1" ? filler : [],
                    }),
                    makePlayer("p2", { graveyard: who === "p2" ? filler : [] }),
                ],
            }),
        };
    }

    it("is +0/+0 at six cards and +2/+2 at seven", () => {
        withTemporaryDefinition(card, () => {
            const six = board(6);
            expect(getEffectivePower(six.state, six.mongoose)).toBe(1);
            const seven = board(7);
            expect(getEffectivePower(seven.state, seven.mongoose)).toBe(3);
            expect(getEffectiveToughness(seven.state, seven.mongoose)).toBe(3);
        });
    });

    it("counts only its controller's graveyard", () => {
        withTemporaryDefinition(card, () => {
            const theirs = board(7, "p2");
            expect(getEffectivePower(theirs.state, theirs.mongoose)).toBe(1);
        });
    });

    it("wire format: the count survives projectPublicState", () => {
        withTemporaryDefinition(card, () => {
            const { state } = board(7);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]?.battlefield.find(
                (c) => c.id === "mongoose"
            );
            expect(slim).toBeDefined();
            expect(getEffectivePower(projected, slim!)).toBe(3);
        });
    });
});

describe("Graveyard-zone phase trigger (CR 113.6b)", () => {
    it("conditionRule reads the intervening-if as a zone, for card and creature", () => {
        for (const noun of ["card", "creature"]) {
            const parsed = conditionRule.run(
                `if this ${noun} is in your graveyard`,
                parseContext()
            );
            expect(parsed.ok).toBe(true);
            if (parsed.ok)
                expect(parsed.value).toEqual({ kind: "self-in-graveyard" });
        }
    });

    it("lowers to the ability's zone, with no board predicate left over", () => {
        const def = compiled(
            creature(
                "Probe",
                "{1}{B}",
                "Zombie",
                "At the beginning of your upkeep, if this card is in your graveyard, you gain 1 life."
            )
        );
        expect(def.compiledTriggeredAbilities).toEqual([
            expect.objectContaining({
                head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                zone: "graveyard",
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            }),
        ]);
        expect(def.compiledTriggeredAbilities?.[0]).not.toHaveProperty(
            "condition"
        );
    });

    it.each([
        [
            "a head that is not a step",
            "Whenever you cast a spell, if this card is in your graveyard, you gain 1 life.",
        ],
        [
            "another card's zone",
            "At the beginning of your upkeep, if target creature is in your graveyard, you gain 1 life.",
        ],
        [
            "an opponent's graveyard",
            "At the beginning of your upkeep, if this card is in an opponent's graveyard, you gain 1 life.",
        ],
    ])("refuses %s", (_form, text) => {
        expect(
            compileCard(creature("Probe", "{1}{B}", "Zombie", text)).state
        ).toBe("unparsed");
    });
});
