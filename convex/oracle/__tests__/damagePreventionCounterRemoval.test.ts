// "If damage would be dealt to <self>, prevent that damage. Remove a +1/+1
// counter from <self>." — the static clause frame (CR 615, issue #4549), the
// Phantom cycle.
//
// Four layers, each watching a different way the frame can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition: the flag beside an entry rider (Phantom Tiger),
//     beside protection (Phantom Centaur) and beside trample and a damage
//     trigger (Phantom Nishoba).
//  2. REFUSALS — the neighbours of the sentence stay unparsed.
//  3. EXPANSION — `expandDefinition` rebuilds the flag into two
//     `replacementEffects[]` entries and removes it.
//  4. BEHAVIOUR — through the real `runDamageReplacement` funnel: the damage
//     is prevented and exactly one counter comes off; under "can't be
//     prevented" (CR 615.12) the damage lands but the counter still comes off;
//     with no counter left the damage is still prevented.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { runDamageReplacement } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const CLAUSE =
    "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature.";

const PHANTOM_TIGER = oracleCard({
    oracleId: "1755b3d4-0e40-40c4-b913-0960d55d411b",
    name: "Phantom Tiger",
    manaCost: "{2}{G}",
    typeLine: "Creature — Cat Spirit",
    oracleText: `This creature enters with two +1/+1 counters on it.\n${CLAUSE}`,
    power: "1",
    toughness: "0",
});

const PHANTOM_CENTAUR = oracleCard({
    oracleId: "9bb8c54b-1228-4b7c-8651-52cb5b0f6e72",
    name: "Phantom Centaur",
    manaCost: "{2}{G}{G}",
    typeLine: "Creature — Centaur Spirit",
    oracleText: `Protection from black\nThis creature enters with three +1/+1 counters on it.\n${CLAUSE}`,
    power: "2",
    toughness: "0",
});

const PHANTOM_NISHOBA = oracleCard({
    oracleId: "e43e06fb-52b7-4f38-8fac-f31973b043f7",
    name: "Phantom Nishoba",
    manaCost: "{5}{G}{W}",
    typeLine: "Creature — Cat Beast Spirit",
    oracleText: `Trample\nThis creature enters with seven +1/+1 counters on it.\nWhenever this creature deals damage, you gain that much life.\n${CLAUSE}`,
    power: "0",
    toughness: "0",
});

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("damage prevention counter removal — golden fixtures (CR 615)", () => {
    it("Phantom Tiger: the flag beside an entry rider", () => {
        expect(sortKeys(compiled(PHANTOM_TIGER))).toEqual(
            sortKeys({
                name: "Phantom Tiger",
                types: ["Creature"],
                subtypes: ["Cat", "Spirit"],
                manaCost: { X: 2, G: 1 },
                power: 1,
                toughness: 0,
                oracleText: PHANTOM_TIGER.oracleText,
                entersWith: { counters: [{ type: "+1/+1", count: 2 }] },
                damagePreventionCounterRemoval: true,
            })
        );
    });

    it("Phantom Centaur: the flag beside protection", () => {
        expect(sortKeys(compiled(PHANTOM_CENTAUR))).toEqual(
            sortKeys({
                name: "Phantom Centaur",
                types: ["Creature"],
                subtypes: ["Centaur", "Spirit"],
                manaCost: { X: 2, G: 2 },
                power: 2,
                toughness: 0,
                oracleText: PHANTOM_CENTAUR.oracleText,
                staticAbilities: ["protection from black"],
                entersWith: { counters: [{ type: "+1/+1", count: 3 }] },
                damagePreventionCounterRemoval: true,
            })
        );
    });

    it("Phantom Nishoba: the flag beside trample and a damage trigger", () => {
        expect(sortKeys(compiled(PHANTOM_NISHOBA))).toEqual(
            sortKeys({
                name: "Phantom Nishoba",
                types: ["Creature"],
                subtypes: ["Cat", "Beast", "Spirit"],
                manaCost: { X: 5, W: 1, G: 1 },
                power: 0,
                toughness: 0,
                oracleText: PHANTOM_NISHOBA.oracleText,
                staticAbilities: ["trample"],
                compiledTriggeredAbilities: [
                    {
                        id: "phantom-nishoba-trigger",
                        oracleText:
                            "Whenever this creature deals damage, you gain that much life.",
                        head: {
                            kind: "damage-dealt",
                            source: "self",
                            recipient: "any",
                        },
                        effects: [
                            {
                                op: "gainLife",
                                player: "controller",
                                amount: { ref: "$event.amount" },
                            },
                        ],
                    },
                ],
                entersWith: { counters: [{ type: "+1/+1", count: 7 }] },
                damagePreventionCounterRemoval: true,
            })
        );
    });

    it("reads the bare sentence into the clause and routes it to the static slot", () => {
        const line = CLAUSE.replaceAll("this creature", "{self}");
        const parsed = staticSlot.run(line, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "damage-prevention-counter-removal",
            });
        const routed = routeLine(line, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("damage prevention counter removal — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string][] = [
        [
            "a damage source filter",
            "If a source would deal damage to this creature, prevent that damage. Remove a +1/+1 counter from this creature.",
        ],
        [
            "a subject that is not this object",
            "If damage would be dealt to target creature, prevent that damage. Remove a +1/+1 counter from this creature.",
        ],
        [
            "a counter taken from another object",
            "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from target creature.",
        ],
        [
            "a counter per point of damage (Rock Hydra)",
            "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature for each 1 damage prevented this way.",
        ],
        [
            "a different counter kind",
            "If damage would be dealt to this creature, prevent that damage. Remove a -1/-1 counter from this creature.",
        ],
        [
            "two counters",
            "If damage would be dealt to this creature, prevent that damage. Remove two +1/+1 counters from this creature.",
        ],
        [
            "a partial prevention",
            "If damage would be dealt to this creature, prevent 1 of that damage. Remove a +1/+1 counter from this creature.",
        ],
        [
            "the prevention without the counter",
            "If damage would be dealt to this creature, prevent that damage.",
        ],
    ];

    it("control: the accepted sentence on the same card compiles ready", () => {
        const outcome = compileCard(
            oracleCard({ name: "Test Card", oracleText: CLAUSE })
        );
        expect(outcome.state).toBe("ready");
    });

    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            const outcome = compileCard(
                oracleCard({ name: "Test Card", oracleText: text })
            );
            expect(outcome.state).toBe("unparsed");
        });
});

describe("damage prevention counter removal — expansion at the expandDefinition seam", () => {
    it("rebuilds the flag into two entries and removes it", () => {
        const def: CardDefinition = {
            ...compiled(PHANTOM_TIGER),
            id: "test-phantom-tiger",
            rarity: "common",
        };
        const expanded = expandDefinition(def);
        expect(expanded.damagePreventionCounterRemoval).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [r.id, r.damageEffectKind])
        ).toEqual([
            ["phantom-tiger-damage-prevention-counter", "other"],
            ["phantom-tiger-damage-prevention", "prevention"],
        ]);
    });

    it("does not add entries beside hand-written ones of the same id", () => {
        const once = expandDefinition({
            ...compiled(PHANTOM_TIGER),
            id: "test-phantom-tiger-hand",
            rarity: "common",
        });
        const again = expandDefinition({
            ...once,
            damagePreventionCounterRemoval: true,
        });
        expect(again.replacementEffects).toEqual(once.replacementEffects);
    });
});

describe("damage prevention counter removal — behaviour (CR 615)", () => {
    function strike(
        counters: number,
        unpreventable: boolean
    ): { amount: number; counters: number } {
        const def: CardDefinition = {
            ...compiled(PHANTOM_TIGER),
            id: `test-phantom-tiger-behaviour-${counters}-${unpreventable}`,
            rarity: "common",
        };
        return withTemporaryDefinition(def, () => {
            const phantom = makeInstance(def.id, {
                id: "phantom",
                controllerId: "p1",
                ...(counters > 0 ? { counters: { "+1/+1": counters } } : {}),
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [phantom] }),
                    makePlayer("p2"),
                ],
            });
            const out = runDamageReplacement(
                state,
                "bolt",
                "p2",
                { type: "permanent", id: "phantom" },
                3,
                false,
                unpreventable
            );
            return {
                amount: out.amount,
                counters: phantom.counters?.["+1/+1"] ?? 0,
            };
        });
    }

    it("prevents the whole event and removes exactly one counter", () => {
        expect(strike(2, false)).toEqual({ amount: 0, counters: 1 });
    });

    it("control: three damage still costs one counter, not three", () => {
        expect(strike(5, false).counters).toBe(4);
    });

    it("CR 615.12: unpreventable damage lands, but the counter still comes off", () => {
        expect(strike(2, true)).toEqual({ amount: 3, counters: 1 });
    });

    it("with no counter left the damage is still prevented", () => {
        expect(strike(0, false)).toEqual({ amount: 0, counters: 0 });
    });
});
