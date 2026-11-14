// CR 613.4 / CR 208.3 (issue #9480) — `EffectCardFilter.powerAtLeast`, "a
// creature with power N or greater" (Ferocious). Read off the EFFECTIVE power
// a battlefield scan supplies (layer 7: a +1/+1 counter counts), fail-closed
// on a noncreature permanent (CR 208.3 — no power, even a printed one), and
// refused by the validator on any hidden-zone selector.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import type { CardInstanceState } from "../../state";
import { getPlayer, resolveTopOfStack } from "../../state";
import { validateEffectScript } from "../validate";

function body(id: string, power: number, types: string[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 3 },
        types,
        power,
        toughness: 3,
    } as CardDefinition);
    return id;
}

const BEAR_THREE = body("t9480-three-power", 3, ["Creature"]);
const BEAR_FOUR = body("t9480-four-power", 4, ["Creature"]);
// CR 208.3 — a Vehicle-shaped noncreature artifact with a printed power.
const UNCREWED = body("t9480-uncrewed", 6, ["Artifact"]);

/** The acceptance script from issue #9480: gain 1 life iff the controller
 *  controls a creature with power 4 or greater. */
const FEROCIOUS: EffectOp[] = [
    {
        op: "if",
        predicate: {
            left: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Creature", powerAtLeast: 4 },
                },
            },
            op: "ge",
            right: 1,
        },
        then: [{ op: "gainLife", player: "controller", amount: 1 }],
    },
] as unknown as EffectOp[];

const SPELL = "t9480-ferocious-spell";
registerTokenDefinition({
    id: SPELL,
    name: SPELL,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: FEROCIOUS,
} as CardDefinition);

/** Life p1 gains from resolving the script with `battlefield` under p1. */
function lifeGained(battlefield: CardInstanceState[]): number {
    const state = makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
    const before = getPlayer(state, "p1").life;
    pushSpell(state, SPELL, "p1");
    resolveTopOfStack(state);
    return getPlayer(state, "p1").life - before;
}

const mine = (defId: string, extra: Partial<CardInstanceState> = {}) =>
    makeInstance(defId, { controllerId: "p1", ownerId: "p1", ...extra });

describe("powerAtLeast on a battlefield count (CR 613.4, issue #9480)", () => {
    it("is true for a creature whose printed power meets the bound", () => {
        expect(lifeGained([mine(BEAR_FOUR)])).toBe(1);
    });

    it("is false for a creature below the bound", () => {
        expect(lifeGained([mine(BEAR_THREE)])).toBe(0);
    });

    it("reads EFFECTIVE power: a +1/+1 counter lifts a 3-power creature to 4", () => {
        expect(
            lifeGained([mine(BEAR_THREE, { counters: { "+1/+1": 1 } })])
        ).toBe(1);
    });

    it("a noncreature permanent has no power and never matches (CR 208.3)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine(UNCREWED)] }),
                makePlayer("p2"),
            ],
        });
        registerTokenDefinition({
            id: "t9480-any-type",
            name: "t9480-any-type",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Instant"],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { powerAtLeast: 1 },
                            },
                        },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 1 }],
                },
            ],
        } as unknown as CardDefinition);
        const before = getPlayer(state, "p1").life;
        pushSpell(state, "t9480-any-type", "p1");
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(before);
    });
});

describe("powerAtLeast validator gate (issue #9480)", () => {
    const host = (zone: string, powerAtLeast: unknown) => ({
        id: "t9480-host",
        name: "Host",
        effects: [
            {
                op: "if",
                predicate: {
                    left: {
                        count: {
                            zone,
                            controller: "controller",
                            filter:
                                powerAtLeast === undefined
                                    ? { type: "Creature" }
                                    : { type: "Creature", powerAtLeast },
                        },
                    },
                    op: "ge",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 1 }],
            },
        ] as never,
    });

    it("accepts the issue's acceptance script on a battlefield count", () => {
        expect(validateEffectScript(host("battlefield", 4))).toEqual([]);
    });

    it("refuses it on a hidden-zone count, where no effective power exists", () => {
        // Control: the same graveyard count without the bound is valid.
        expect(validateEffectScript(host("graveyard", undefined))).toEqual([]);
        expect(validateEffectScript(host("graveyard", 4))).not.toEqual([]);
    });

    it("refuses a zero or fractional bound", () => {
        expect(validateEffectScript(host("battlefield", 0))).not.toEqual([]);
        expect(validateEffectScript(host("battlefield", 2.5))).not.toEqual([]);
    });
});
