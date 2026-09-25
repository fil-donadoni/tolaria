// Walker-reach snapshot — every static walk over a nested Effect Script, and
// which nesting shapes it actually sees (issue #4442).
//
// CR 608.2c — a spell's instructions are followed in the order written, nested
// ones included; an Op a walker cannot see is an instruction it cannot read:
// not valued, not signed, not timed, not catalogued. Each walker below is
// driven through the observable it exists to compute, with ONE marker Op nested
// under ONE shape at a time (`NESTING_SHAPES`), and records whether the marker
// moved that observable. The shared fixture is the one `childOpArrays`'s own
// test stands on, so a new nesting Op added there reaches this table too.

import { describe, expect, it } from "vitest";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
} from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import { collectTokenSpecs } from "../../cards/tokenCatalogue";
import { childOpArrays } from "../ai/effectOpChildren";
import { targetSlotBeneficence } from "../ai/beneficence";
import {
    isTransientOnlyAbility,
    spendsStandingPermanent,
} from "../ai/abilityTiming";
import { valueEffectScript } from "../ai/opValuers";
import { NESTING_SHAPES, type NestingShape } from "./fixtures/nestedOpShapes";

/** Whether `walk` sees an Op nested under `shape`. */
type Reaches = (shape: NestingShape) => boolean;

function ability(effects: EffectOp[]): ActivatedAbility {
    return {
        id: "walker-reach",
        cost: { sacrifice: true },
        useStack: true,
        effects,
    } as ActivatedAbility;
}

const LASTING: EffectOp = { op: "addMana", mana: { C: 1 } };
function transientOp(): EffectOp {
    return {
        op: "pump",
        target: { target: 0 },
        power: 1,
        toughness: 1,
        duration: { phase: "end-of-turn" },
    } as EffectOp;
}

/** `shape`'s host with `inner` in the shape's list and a transient filler in
 *  every OTHER list the host carries, so only the shape's list decides a
 *  whole-script predicate (an empty list is never transient). */
function hostWithFiller(shape: NestingShape, inner: EffectOp[]): EffectOp {
    const host = shape.nest(inner);
    for (const list of childOpArrays(host)) {
        if (list.length === 0) (list as EffectOp[]).push(transientOp());
    }
    return host;
}

const WALKERS: Readonly<Record<string, Reaches>> = {
    childOpArrays: (shape) => {
        const marker: EffectOp = {
            op: "gainLife",
            player: "controller",
            amount: 1,
        };
        return childOpArrays(shape.nest([marker])).some((l) =>
            l.includes(marker)
        );
    },
    // tokenCatalogue — the marker is a `createToken`; reached = catalogued.
    tokenCatalogue: (shape) =>
        collectTokenSpecs([
            shape.nest([
                {
                    op: "createToken",
                    token: {
                        name: "Marker",
                        types: ["Creature"],
                        power: 1,
                        toughness: 1,
                    },
                    controller: "controller",
                } as EffectOp,
            ]),
        ]).length === 1,
    // beneficence — the marker damages announced slot 0; reached = signed.
    beneficence: (shape) =>
        targetSlotBeneficence(
            {
                effects: [
                    shape.nest([
                        { op: "dealDamage", amount: 1, to: { target: 0 } },
                    ]),
                ],
            } as CardDefinition,
            undefined,
            0
        ) === "harmful",
    // opValuers — the marker gains life; reached = its tag reaches the value.
    // The TAG, not the points: how a host COMBINES its branches (a minimax
    // over piles, an even-odds flip) is valuation, and a min against an empty
    // pile is 0 points for a marker the walk did see.
    opValuers: (shape) =>
        valueEffectScript([
            shape.nest([{ op: "gainLife", player: "controller", amount: 3 }]),
        ]).tags.includes("lifeSwing"),
    // abilityTiming (mana) — a sacrifice outlet whose script adds mana is NOT
    // spending a standing permanent; reached = the `addMana` was seen.
    abilityTimingMana: (shape) =>
        !spendsStandingPermanent(
            {} as GameState,
            {} as CardInstanceState,
            ability([shape.nest([{ op: "addMana", mana: { C: 1 } }])])
        ),
    // abilityTiming (transient) — reached = an all-transient host reads
    // transient AND a lasting marker in the shape's list flips it.
    abilityTimingTransient: (shape) =>
        isTransientOnlyAbility(
            ability([hostWithFiller(shape, [transientOp()])])
        ) &&
        !isTransientOnlyAbility(ability([hostWithFiller(shape, [LASTING])])),
};

function reachSet(walk: Reaches): string[] {
    return NESTING_SHAPES.filter(walk).map((s) => s.label);
}

const ALL = NESTING_SHAPES.map((s) => s.label);
const without = (...labels: string[]) => ALL.filter((l) => !labels.includes(l));
const DIVERGENT_TAIL = [
    "delayedTrigger.effects",
    "reflexiveTrigger.effects",
    "divideIntoPiles.chosenEffect",
    "divideIntoPiles.otherEffect",
];

describe("nested-Op walkers — reach per nesting shape (CR 608.2c, issue #4442)", () => {
    it("snapshot: each walker's reach set", () => {
        const reach = Object.fromEntries(
            Object.entries(WALKERS).map(([name, walk]) => [
                name,
                reachSet(walk),
            ])
        );
        expect(reach).toEqual({
            childOpArrays: ALL,
            tokenCatalogue: without(
                "coinFlipSync.win",
                "coinFlipSync.loss",
                "reflexiveTrigger.effects",
                "divideIntoPiles.chosenEffect",
                "divideIntoPiles.otherEffect"
            ),
            beneficence: without(...DIVERGENT_TAIL),
            opValuers: without("if.else"),
            abilityTimingMana: without(...DIVERGENT_TAIL),
            abilityTimingTransient: without(...DIVERGENT_TAIL),
        });
    });
});
