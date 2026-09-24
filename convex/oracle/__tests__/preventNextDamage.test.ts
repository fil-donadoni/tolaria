// "Prevent the next N damage that would be dealt to any target this turn" —
// a prevention SHIELD of a printed size (CR 615.7, CR 615.1a, issue #4300) —
// and its bare "target creature" recipient (issue #4309).
//
// Two layers:
//
//  1. GOLDENS — one per slot the shared effect-clause rule serves: the
//     activated slot behind a `{T}` cost (Samite Healer, Master Healer — the
//     printed number is read, not assumed to be 1) and the spell slot (Mending
//     Hands); for "target creature", the activated slot behind a `{T}` cost
//     (Oasis) and a life cost (Martyrs' Tomb), and a modal spell's mode
//     (Recuperate). Whole cards, whole Compiled Definitions.
//  2. REFUSALS — the neighbours the rule must NOT read: a recipient other than
//     "any target" or a bare "target creature" (a QUALIFIED creature
//     included — Wandering Mage's "target Cleric or Wizard creature"), a
//     shield that is not printed digits, a shield with no
//     duration, and the two real cards whose rider sentence is another
//     Grammar Gap (Elvish Healer's "instead", Rakalite's delayed return, Test
//     of Faith's "for each 1 damage prevented this way") —
//     each pinned to the SPAN that stops the card, so the shield sentence the
//     rule now reads is provably not the one refused.

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

const OASIS: OracleCard = {
    oracleId: "4533ce78-0594-4195-96fb-46cbadd0db69",
    name: "Oasis",
    manaCost: "",
    typeLine: "Land",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
    layout: "normal",
};

const MARTYRS_TOMB: OracleCard = {
    oracleId: "a0baa9eb-0b1e-4d90-a7a1-f7102f575467",
    name: "Martyrs' Tomb",
    manaCost: "{2}{W}{B}",
    typeLine: "Enchantment",
    oracleText:
        "Pay 2 life: Prevent the next 1 damage that would be dealt to target creature this turn.",
    layout: "normal",
};

const RECUPERATE: OracleCard = {
    oracleId: "07d7f9d2-5414-4aaf-b6f2-1fedf16c3af7",
    name: "Recuperate",
    manaCost: "{3}{W}",
    typeLine: "Instant",
    oracleText:
        "Choose one —\n• You gain 6 life.\n• Prevent the next 6 damage that would be dealt to target creature this turn.",
    layout: "normal",
};

const TEST_OF_FAITH: OracleCard = {
    oracleId: "3397aa3d-bf73-4ca3-a806-059361603079",
    name: "Test of Faith",
    manaCost: "{1}{W}",
    typeLine: "Instant",
    oracleText:
        "Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature.",
    layout: "normal",
};

const WANDERING_MAGE: OracleCard = {
    oracleId: "ac9c81a1-f444-4051-b309-f1af1b5df12a",
    name: "Wandering Mage",
    manaCost: "{W}{U}{B}",
    typeLine: "Creature — Human Cleric Wizard",
    oracleText:
        "{W}, Pay 1 life: Prevent the next 2 damage that would be dealt to target creature this turn.\n{U}: Prevent the next 1 damage that would be dealt to target Cleric or Wizard creature this turn.\n{B}, Put a -1/-1 counter on a creature you control: Prevent the next 2 damage that would be dealt to target player or planeswalker this turn.",
    power: "0",
    toughness: "3",
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
const TARGET_CREATURE = { type: "Creature", count: 1 };

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

describe("prevent the next N damage to target creature — goldens (CR 615.7, CR 115.1c)", () => {
    it("activated slot, {T} cost: Oasis — a 1-damage shield on the announced creature", () => {
        expect(sortKeys(compiled(OASIS))).toEqual(
            sortKeys({
                name: "Oasis",
                types: ["Land"],
                oracleText:
                    "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
                activatedAbilities: [
                    {
                        id: "oasis-ability",
                        oracleText:
                            "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [shield(1)],
                        targetRequirement: TARGET_CREATURE,
                    },
                ],
            })
        );
    });

    it("activated slot, life cost: Martyrs' Tomb — the same shield behind 'Pay 2 life'", () => {
        expect(sortKeys(compiled(MARTYRS_TOMB))).toEqual(
            sortKeys({
                name: "Martyrs' Tomb",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 1, B: 1 },
                oracleText:
                    "Pay 2 life: Prevent the next 1 damage that would be dealt to target creature this turn.",
                activatedAbilities: [
                    {
                        id: "martyrs-tomb-ability",
                        oracleText:
                            "Pay 2 life: Prevent the next 1 damage that would be dealt to target creature this turn.",
                        cost: { life: 2 },
                        useStack: true,
                        effects: [shield(1)],
                        targetRequirement: TARGET_CREATURE,
                    },
                ],
            })
        );
    });

    it("spell slot, modal: Recuperate — the shield is one mode, announcing its own creature", () => {
        expect(sortKeys(compiled(RECUPERATE))).toEqual(
            sortKeys({
                name: "Recuperate",
                types: ["Instant"],
                manaCost: { X: 3, W: 1 },
                oracleText:
                    "Choose one —\n• You gain 6 life.\n• Prevent the next 6 damage that would be dealt to target creature this turn.",
                modes: [
                    {
                        id: "recuperate-mode-1",
                        label: "You gain 6 life",
                        oracleText: "You gain 6 life.",
                        effects: [
                            { op: "gainLife", player: "controller", amount: 6 },
                        ],
                    },
                    {
                        id: "recuperate-mode-2",
                        label: "Prevent the next 6 damage that would be dealt to target creature this turn",
                        oracleText:
                            "Prevent the next 6 damage that would be dealt to target creature this turn.",
                        effects: [shield(6)],
                        targetRequirement: TARGET_CREATURE,
                    },
                ],
            })
        );
    });
});

describe("prevent the next N damage — refusals stay fail-closed", () => {
    it("reads 'any target' or a bare 'target creature' only: another recipient is refused, not re-pointed", () => {
        for (const recipient of [
            "target player",
            "target legendary creature",
            "target creature you control",
            "target attacking creature",
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

    it("a shield that is not printed digits is refused (X, a spelled number)", () => {
        for (const size of ["X", "one", "a"])
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

    it("Elvish Healer's 'instead' rider is another gap: the whole card stays unparsed", () => {
        expect(refusedSpan(ELVISH_HEALER)).toBe(
            "If it's a green creature, prevent the next 2 damage instead"
        );
    });

    it("Wandering Mage's qualified creature is refused though its bare 'target creature' line reads", () => {
        // The first line is the accepted form; the SECOND stops the card, on
        // the qualifier the shield rule does not read.
        expect(refusedSpan(WANDERING_MAGE)).toBe("Cleric or Wizard creature");
    });

    it("Test of Faith's 'prevented this way' rider is another gap: the whole card stays unparsed", () => {
        expect(refusedSpan(TEST_OF_FAITH)).toBe(
            "For each 1 damage prevented this way, put a +1/+1 counter on that creature"
        );
    });

    it("Rakalite's delayed return is another gap: the whole card stays unparsed", () => {
        // The refusal sits on the RIDER, not on the shield sentence the rule
        // now reads — the span names which sentence stopped the card.
        expect(refusedSpan(RAKALITE)).toBe(
            "its owner's hand at the beginning of the next end step"
        );
    });
});
