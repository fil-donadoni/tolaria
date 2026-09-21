// "Prevent the next N damage that would be dealt to any target this turn" —
// a prevention SHIELD of a printed size (CR 615.7, CR 615.1a, issue #4300).
//
// Three layers:
//
//  1. GOLDENS — one per slot the shared effect-clause rule serves: the
//     activated slot behind a `{T}` cost (Samite Healer, Master Healer — the
//     printed number is read, not assumed to be 1) and the spell slot (Mending
//     Hands). Whole cards, whole Compiled Definitions.
//  2. REFUSALS — the neighbours the rule must NOT read: a recipient other than
//     "any target", a shield that is not a printed number, a shield with no
//     duration, a different prevention ("all"), and the two real cards whose
//     rider sentence is another Grammar Gap (Elvish Healer's "instead",
//     Rakalite's delayed return).
//  3. FRONTIER — every refusal stays `unparsed`, none degrades into a card
//     that reads as the shield alone.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const SAMITE_HEALER: OracleCard = {
    oracleId: "95a0ca48-d924-47f4-86ed-42c673ee778c",
    name: "Samite Healer",
    manaCost: "{1}{W}",
    typeLine: "Creature — Human Cleric",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
    power: "1",
    toughness: "1",
    layout: "normal",
};

const MASTER_HEALER: OracleCard = {
    oracleId: "7695b61a-8d44-44b1-9783-ea3114111c3e",
    name: "Master Healer",
    manaCost: "{4}{W}",
    typeLine: "Creature — Human Cleric",
    oracleText:
        "{T}: Prevent the next 4 damage that would be dealt to any target this turn.",
    power: "1",
    toughness: "4",
    layout: "normal",
};

const MENDING_HANDS: OracleCard = {
    oracleId: "a612f30d-cd55-438b-a7de-8c80509183aa",
    name: "Mending Hands",
    manaCost: "{W}",
    typeLine: "Instant",
    oracleText:
        "Prevent the next 4 damage that would be dealt to any target this turn.",
    layout: "normal",
};

const ELVISH_HEALER: OracleCard = {
    oracleId: "ea46835c-9dac-4e1e-8338-ad99136f511a",
    name: "Elvish Healer",
    manaCost: "{2}{W}",
    typeLine: "Creature — Elf Cleric",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to any target this turn. If it's a green creature, prevent the next 2 damage instead.",
    power: "1",
    toughness: "2",
    layout: "normal",
};

const RAKALITE: OracleCard = {
    oracleId: "193c1671-328e-4f9c-836e-055f46c3aab0",
    name: "Rakalite",
    manaCost: "{6}",
    typeLine: "Artifact",
    oracleText:
        "{2}: Prevent the next 1 damage that would be dealt to any target this turn. Return this artifact to its owner's hand at the beginning of the next end step.",
    layout: "normal",
};

/** An instant whose Oracle text is exactly `oracleText` — a neighbour form
 *  that no corpus card prints, so the refusal is pinned by a probe line. */
function instant(oracleText: string) {
    return oracleCard({
        name: "Shield Probe",
        manaCost: "{W}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The span the compiler refused, or `undefined` when the card compiled. */
function refusedSpan(card: OracleCard): string | undefined {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps[0]?.attribution?.span
        : undefined;
}

function shield(amount: number) {
    return {
        op: "preventDamage",
        mode: "next-n",
        to: { target: 0 },
        amount,
        duration: { phase: "end-of-turn" },
    };
}

const ANY_TARGET = { type: "any", count: 1 };

describe("prevent the next N damage — goldens (CR 615.7)", () => {
    it("activated slot, {T} cost: Samite Healer — a 1-damage shield on the announced any-target", () => {
        expect(sortKeys(compiled(SAMITE_HEALER))).toEqual(
            sortKeys({
                name: "Samite Healer",
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                manaCost: { X: 1, W: 1 },
                power: 1,
                toughness: 1,
                oracleText:
                    "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
                activatedAbilities: [
                    {
                        id: "samite-healer-ability",
                        oracleText:
                            "{T}: Prevent the next 1 damage that would be dealt to any target this turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [shield(1)],
                        targetRequirement: ANY_TARGET,
                    },
                ],
            })
        );
    });

    it("the printed number is the shield size: Master Healer prevents 4", () => {
        expect(sortKeys(compiled(MASTER_HEALER))).toEqual(
            sortKeys({
                name: "Master Healer",
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                manaCost: { X: 4, W: 1 },
                power: 1,
                toughness: 4,
                oracleText:
                    "{T}: Prevent the next 4 damage that would be dealt to any target this turn.",
                activatedAbilities: [
                    {
                        id: "master-healer-ability",
                        oracleText:
                            "{T}: Prevent the next 4 damage that would be dealt to any target this turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [shield(4)],
                        targetRequirement: ANY_TARGET,
                    },
                ],
            })
        );
    });

    it("spell slot: Mending Hands — the same clause, announced by the spell", () => {
        expect(sortKeys(compiled(MENDING_HANDS))).toEqual(
            sortKeys({
                name: "Mending Hands",
                types: ["Instant"],
                manaCost: { W: 1 },
                oracleText:
                    "Prevent the next 4 damage that would be dealt to any target this turn.",
                effects: [shield(4)],
                targetRequirement: ANY_TARGET,
            })
        );
    });
});

describe("prevent the next N damage — refusals stay fail-closed", () => {
    it("reads 'any target' only: another recipient is refused, not re-pointed", () => {
        for (const recipient of [
            "target creature",
            "target player",
            "you",
            "each creature",
        ])
            expect(
                compileCard(
                    instant(
                        `Prevent the next 2 damage that would be dealt to ${recipient} this turn.`
                    )
                ).state,
                recipient
            ).toBe("unparsed");
    });

    it("a shield that is not a printed number is refused (X, 'that much')", () => {
        for (const size of ["X", "that much"])
            expect(
                compileCard(
                    instant(
                        `Prevent the next ${size} damage that would be dealt to any target this turn.`
                    )
                ).state,
                size
            ).toBe("unparsed");
    });

    it("a shield with no duration is refused — never promoted to a permanent one", () => {
        expect(
            compileCard(
                instant(
                    "Prevent the next 2 damage that would be dealt to any target."
                )
            ).state
        ).toBe("unparsed");
    });

    it("a different prevention is not this shield: 'all' damage stays unparsed", () => {
        expect(
            compileCard(
                instant(
                    "Prevent all damage that would be dealt to any target this turn."
                )
            ).state
        ).toBe("unparsed");
    });

    it("Elvish Healer's 'instead' rider is another gap: the whole card stays unparsed", () => {
        expect(refusedSpan(ELVISH_HEALER)).toBe(
            "If it's a green creature, prevent the next 2 damage instead"
        );
    });

    it("Rakalite's delayed return is another gap: the whole card stays unparsed", () => {
        expect(compileCard(RAKALITE).state).toBe("unparsed");
    });
});
