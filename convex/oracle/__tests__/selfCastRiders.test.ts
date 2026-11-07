// The two riders a spell prints about its own cast, read as static clauses:
//
//   "You may cast this spell as though it had flash if you pay {N} more to
//    cast it."                                    CR 601.3c, `flashSurcharge`
//   "Domain — This spell costs {N} less to cast for each basic land type among
//    lands you control."                          CR 601.2f, `selfCostReduction`
//
// Goldens compile REAL corpus Oracle rows and pin the WHOLE definition; the
// refusals pin the printed neighbours the rules must not read; the behaviour
// block runs the compiled fields through the engine's own readers
// (`flashSurchargeRequired`, `getCostModifiers`), which is where a field that
// parsed but lowered wrong would show.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { forest, island } from "../../cards/sets/lea/colorless.cards";
import type { CardDefinition } from "../../cards/types";
import { flashSurchargeRequired } from "../../gre/rules";
import { getCostModifiers } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const ROUT: OracleCard = {
    name: "Rout",
    manaCost: "{3}{W}{W}",
    typeLine: "Sorcery",
    oracleText:
        "You may cast this spell as though it had flash if you pay {2} more to cast it. (You may cast it any time you could cast an instant.)\nDestroy all creatures. They can't be regenerated.",
    oracleId: "d69aa624-23d1-406a-b7e0-9140a6f57929",
    layout: "normal",
};

const HARBINGER_OF_THE_TIDES: OracleCard = {
    name: "Harbinger of the Tides",
    manaCost: "{U}{U}",
    typeLine: "Creature — Merfolk Wizard",
    oracleText:
        "You may cast this spell as though it had flash if you pay {2} more to cast it. (You may cast it any time you could cast an instant.)\nWhen this creature enters, you may return target tapped creature an opponent controls to its owner's hand.",
    power: "2",
    toughness: "2",
    oracleId: "9f5277e8-1cbe-478c-a8bc-ac028f13305e",
    layout: "normal",
};

const STRATADON: OracleCard = {
    name: "Stratadon",
    manaCost: "{10}",
    typeLine: "Artifact Creature — Beast",
    oracleText:
        "Domain — This spell costs {1} less to cast for each basic land type among lands you control.\nTrample",
    power: "5",
    toughness: "5",
    oracleId: "3b78b672-7773-44c6-9a21-f89c058966ff",
    layout: "normal",
};

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function golden(card: OracleCard, expected: CompiledDefinition): void {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

/** A corpus row, or one neighbour of it, stays out on exactly this line. */
function refusedOn(oracleText: string, line: string): void {
    const outcome = compileCard(
        oracleCard({
            name: "Probe Spell",
            manaCost: "{2}{U}",
            typeLine: "Creature — Faerie",
            oracleText,
            power: "2",
            toughness: "2",
        })
    );
    expect(outcome.state).toBe("unparsed");
    if (outcome.state !== "unparsed") return;
    expect(outcome.gaps.map((g) => g.fragment)).toContain(line);
}

describe("flash surcharge — goldens (CR 601.3c)", () => {
    it("Rout: a sorcery carries the rider beside its spell text", () => {
        golden(ROUT, {
            name: "Rout",
            types: ["Sorcery"],
            manaCost: { X: 3, W: 2 },
            oracleText: ROUT.oracleText,
            flashSurcharge: { X: 2 },
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$each" },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
        });
    });

    it("Harbinger of the Tides: a permanent spell carries the same field", () => {
        golden(HARBINGER_OF_THE_TIDES, {
            name: "Harbinger of the Tides",
            types: ["Creature"],
            subtypes: ["Merfolk", "Wizard"],
            manaCost: { U: 2 },
            power: 2,
            toughness: 2,
            oracleText: HARBINGER_OF_THE_TIDES.oracleText,
            flashSurcharge: { X: 2 },
            compiledTriggeredAbilities: [
                {
                    id: "harbinger-of-the-tides-trigger",
                    oracleText:
                        "When this creature enters, you may return target tapped creature an opponent controls to its owner's hand.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        tappedFilter: "tapped",
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Return target tapped creature an opponent controls to its owner's hand?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { target: 0 },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });
});

describe("flash surcharge — refused neighbours (fail-closed)", () => {
    it.each([
        "You may cast this spell as though it had flash if you control a Faerie.",
        "You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it.",
        "You may cast this spell as though it had flash if it targets a permanent you control.",
    ])("%s", (line) => {
        refusedOn(line, line);
    });
});

describe("flash surcharge — behaviour through the engine (CR 601.3c)", () => {
    const rout = {
        ...compiled(ROUT),
        id: "test-self-cast-rout",
        rarity: "rare",
    } as CardDefinition;

    function owed(stateOverrides: object): boolean {
        return withTemporaryDefinition(rout, () => {
            const card = makeInstance(rout.id, { zone: "hand" });
            const state = makeState({
                players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
                ...stateOverrides,
            });
            return flashSurchargeRequired(state, "p1", card);
        });
    }

    it("charges the rider on a cast a sorcery could not have made", () => {
        expect(owed({ activePlayerId: "p2", priorityPlayerId: "p1" })).toBe(
            true
        );
    });

    it("owes nothing at sorcery timing", () => {
        expect(
            owed({
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                phase: "PRECOMBAT_MAIN",
                stack: [],
            })
        ).toBe(false);
    });
});

describe("domain self cost reduction — golden (CR 601.2f, CR 305.6)", () => {
    it("Stratadon: the census reduction, its keyword line beside it", () => {
        golden(STRATADON, {
            name: "Stratadon",
            types: ["Artifact", "Creature"],
            subtypes: ["Beast"],
            manaCost: { X: 10 },
            power: 5,
            toughness: 5,
            oracleText: STRATADON.oracleText,
            staticAbilities: ["trample"],
            selfCostReduction: {
                costReduction: {
                    perCount: { X: 1 },
                    countMode: "domain",
                },
            },
        });
    });

    it("reads the printed amount: Draco's {2} is not a fixed {1}", () => {
        const twoPerType = compiled({
            ...STRATADON,
            oracleText:
                "Domain — This spell costs {2} less to cast for each basic land type among lands you control.\nTrample",
        });
        expect(twoPerType.selfCostReduction).toEqual({
            costReduction: { perCount: { X: 2 }, countMode: "domain" },
        });
    });
});

describe("domain self cost reduction — refused neighbours (fail-closed)", () => {
    it.each([
        // another census, printed without the ability word
        "This spell costs {1} less to cast for each artifact you control.",
        // the census with no ability word heading it: no card prints this
        "This spell costs {1} less to cast for each basic land type among lands you control.",
        // Draco's upkeep line: the same census, reducing another cost
        "Domain — At the beginning of your upkeep, sacrifice this creature unless you pay {10}. This cost is reduced by {2} for each basic land type among lands you control.",
    ])("%s", (line) => {
        refusedOn(line, line);
    });
});

describe("domain self cost reduction — behaviour through the engine (CR 601.2f)", () => {
    const stratadon = {
        ...compiled(STRATADON),
        id: "test-self-cast-stratadon",
        rarity: "uncommon",
    } as CardDefinition;

    it("reduces per basic land TYPE, so a second Forest adds nothing (CR 305.6)", () => {
        withTemporaryDefinition(stratadon, () => {
            const spell = makeInstance(stratadon.id, { zone: "hand" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [spell],
                        battlefield: [
                            makeInstance(forest().id, { id: "f1" }),
                            makeInstance(forest().id, { id: "f2" }),
                            makeInstance(island().id, { id: "i1" }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            expect(
                getCostModifiers(state, spell, "spell").reductionGeneric
            ).toBe(2);
        });
    });
});
