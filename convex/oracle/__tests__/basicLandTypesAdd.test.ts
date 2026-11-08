// "Lands you control are every basic land type in addition to their other
// types" (CR 305.7 / 613.1d, issue #8590): the additive layer-4 land-type
// frame of `characteristicStatic.ts`.
//
//  1. GOLDEN — each real corpus card printing the form, the whole Compiled
//     Definition compared.
//  2. REFUSALS — the neighbours the frame must not read, fail-closed.
//  3. EXPANSION — the descriptor rebuilds into the hand-written card's
//     `subtype-add`, its CR 613.8a reads included (Guard C's comparator).

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import { expandCompiledStatics } from "../../cards/compiledStatics";
import { basicLandTypesAddRule } from "../grammar/shared/characteristicStatic";
import { compileCard } from "../compile";
import { roundTripCard } from "../gold";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const LINE =
    "Lands you control are every basic land type in addition to their other types.";

const FIVE_BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

const LANDS_YOU_CONTROL = { types: ["Land"], controllerRelation: "you" };

const PRISMATIC_OMEN = oracleCard({
    name: "Prismatic Omen",
    manaCost: "{1}{G}",
    typeLine: "Enchantment",
    power: undefined,
    toughness: undefined,
    oracleText: LINE,
});

const DRYAD_OF_THE_ILYSIAN_GROVE = oracleCard({
    name: "Dryad of the Ilysian Grove",
    manaCost: "{2}{G}",
    typeLine: "Enchantment Creature — Nymph Dryad",
    power: "2",
    toughness: "4",
    oracleText: `You may play an additional land on each of your turns.\n${LINE}`,
});

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome;
}

function unparsed(oracleText: string): boolean {
    return (
        compileCard(
            oracleCard({
                name: "Test Omen",
                manaCost: "{1}{G}",
                typeLine: "Enchantment",
                power: undefined,
                toughness: undefined,
                oracleText,
            })
        ).state === "unparsed"
    );
}

describe("every basic land type in addition — goldens (CR 305.7)", () => {
    it("Prismatic Omen: subtype-add of the five basics over lands you control", () => {
        expect(compiled(PRISMATIC_OMEN).definition).toEqual({
            name: "Prismatic Omen",
            types: ["Enchantment"],
            manaCost: { X: 1, G: 1 },
            oracleText: LINE,
            compiledStaticEffects: [
                {
                    kind: "subtype-add",
                    filter: LANDS_YOU_CONTROL,
                    subtypes: FIVE_BASICS,
                },
            ],
        });
    });

    it("Dryad of the Ilysian Grove: the same frame beside an extra land drop", () => {
        expect(compiled(DRYAD_OF_THE_ILYSIAN_GROVE).definition).toEqual({
            name: "Dryad of the Ilysian Grove",
            types: ["Enchantment", "Creature"],
            subtypes: ["Nymph", "Dryad"],
            manaCost: { X: 2, G: 1 },
            power: 2,
            toughness: 4,
            oracleText: `You may play an additional land on each of your turns.\n${LINE}`,
            compiledStaticEffects: [
                {
                    kind: "subtype-add",
                    filter: LANDS_YOU_CONTROL,
                    subtypes: FIVE_BASICS,
                },
            ],
            extraLandDrops: 1,
        });
    });
});

describe("every basic land type in addition — refusals (fail-closed)", () => {
    it("REFUSES a subject that is not a set of lands (CR 205.3i)", () => {
        expect(
            unparsed(
                "Creatures you control are every basic land type in addition to their other types."
            )
        ).toBe(true);
        expect(
            basicLandTypesAddRule.run(
                "Creatures you control are every basic land type in addition to their other types",
                undefined
            ).ok
        ).toBe(false);
    });

    it("REFUSES the replacing form with no 'in addition' tail (CR 305.7 sets, never adds)", () => {
        expect(unparsed("Lands you control are every basic land type.")).toBe(
            true
        );
    });

    it("REFUSES a single named basic land type, another frame's form", () => {
        expect(
            basicLandTypesAddRule.run(
                "Lands you control are Swamps in addition to their other types",
                undefined
            ).ok
        ).toBe(false);
    });

    it("REFUSES a singular subject", () => {
        expect(
            basicLandTypesAddRule.run(
                "Land you control are every basic land type in addition to their other types",
                undefined
            ).ok
        ).toBe(false);
    });
});

describe("every basic land type in addition — expansion (CR 613.8a)", () => {
    it("rebuilds into a subtype-add declaring the layer-4 types it reads", () => {
        const effects =
            expandCompiledStatics(compiled(PRISMATIC_OMEN).definition as never)
                .staticEffects ?? [];
        expect(effects).toHaveLength(1);
        const [effect] = effects;
        expect(effect).toMatchObject({
            kind: "subtype-add",
            subtypes: FIVE_BASICS,
            reads: [{ characteristic: "types", values: ["Land"] }],
        });
    });

    it("round-trips the hand-written Prismatic Omen (Guard C comparator)", () => {
        const raw = getAllRawCards().find((c) => c.name === "Prismatic Omen");
        expect(raw).toBeDefined();
        expect(roundTripCard(raw!).verdict).toEqual({
            ok: true,
            kind: "equal",
        });
    });
});
