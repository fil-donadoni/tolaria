// Removing a permanent of the script's own is a cost, whichever verb does it
// (issue #8246). A selector's owner is read off the script: its battlefield
// source, or a permanent one of its own Ops put onto the battlefield, through
// a `capture` alias too. CR 702.84a is the clause that surfaced it: Unearth's
// delayed "exile it" read as removal aimed at an opposing permanent.

import { describe, it, expect } from "vitest";
import type { EffectCaptureSource, EffectOp } from "../../../cards/types";
import { unearthAbility } from "../../../cards/abilities/unearth";
import { valueEffectScript, valueOp, contextFreeGrounding } from "../index";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { withGraveyardSource } from "../grounding";
import { SAC_SELF_COST } from "../opValuers";
import { roundToPointsGrid } from "./pointsGrid.helper";

const cf = contextFreeGrounding();
const REMOVAL = DEFAULT_EVAL_WEIGHTS.latent.boardRemoval;

type RemovalVerb = "exile" | "destroy";
const VERBS: readonly RemovalVerb[] = ["exile", "destroy"];
/** `REMOVAL_COMPLETENESS`, written the way the valuer multiplies. */
const OPPOSING_PRICE: Record<RemovalVerb, number> = {
    exile: (REMOVAL * 35) / 32,
    destroy: REMOVAL,
};

function delayed(
    verb: RemovalVerb | "sacrifice",
    capture: Record<string, EffectCaptureSource>,
    name: string
): EffectOp {
    return {
        op: "delayedTrigger",
        timing: "next-end-step",
        oracleText: "At the beginning of the next end step, remove it.",
        capture,
        effects: [{ op: verb, target: { ref: name } }],
    } as EffectOp;
}

/** The value of the LAST Op of a script: what the walk read for it once every
 *  Op before it bound what it binds. A difference, so on the rounding grid. */
function lastOpValue(script: readonly EffectOp[], ctx = cf) {
    const all = valueEffectScript(script, ctx);
    const head = valueEffectScript(script.slice(0, -1), ctx);
    return {
        points: roundToPointsGrid(all.points - head.points),
        tags: all.tags,
    };
}

const REVIVE_TOP: EffectOp = {
    op: "moveZone",
    target: {
        zone: "graveyard",
        position: "top",
        player: "controller",
        filter: { type: "Creature" },
    },
    to: "battlefield",
    bind: "$revived",
};

describe("a script's own permanent removed is a cost, not removal (CR 702.84a)", () => {
    it("Unearth's delayed exile, under the graveyard grounding that reads it", () => {
        const script = unearthAbility({ B: 1 }).effects as EffectOp[];
        const ctx = withGraveyardSource(cf);
        const v = lastOpValue(script, ctx);
        expect(v.points).toBe(SAC_SELF_COST);
        expect(v.tags).toContain("self-cost");
    });

    for (const verb of VERBS) {
        describe(`${verb}`, () => {
            it("of the battlefield source", () => {
                const v = valueOp({ op: verb, target: { ref: "$source" } }, cf);
                expect(v.points).toBe(SAC_SELF_COST);
                expect(v.tags).toContain("self-cost");
            });

            it("of a capture aliasing the battlefield source", () => {
                const v = valueEffectScript(
                    [delayed(verb, { $self: { ref: "$source" } }, "$self")],
                    cf
                );
                expect(v.points).toBe(SAC_SELF_COST);
            });

            it("of a capture aliasing a card the script reanimated", () => {
                const v = lastOpValue([
                    REVIVE_TOP,
                    delayed(
                        verb,
                        { $captured: { ref: "$revived" } },
                        "$captured"
                    ),
                ]);
                expect(v.points).toBe(SAC_SELF_COST);
            });

            it("of a capture two levels down, through an `if`", () => {
                const v = lastOpValue([
                    REVIVE_TOP,
                    {
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { ref: "$revived" },
                            filter: { type: "Creature" },
                        },
                        then: [
                            delayed(
                                verb,
                                { $captured: { ref: "$revived" } },
                                "$captured"
                            ),
                        ],
                    },
                ]);
                expect(v.points).toBe(SAC_SELF_COST);
            });

            it("of a token copy the script made for its controller", () => {
                const v = lastOpValue([
                    {
                        op: "createTokenCopy",
                        source: { target: 0 },
                        controller: "controller",
                        bind: "$copy",
                    },
                    delayed(verb, { $token: { ref: "$copy" } }, "$token"),
                ]);
                expect(v.points).toBe(SAC_SELF_COST);
            });

            it("of a card named by a controller-side `moveZone { cards }`", () => {
                const v = lastOpValue([
                    {
                        op: "moveZone",
                        cards: { ref: "$picked" },
                        player: "controller",
                        from: "hand",
                        to: "battlefield",
                        bind: "$sneak",
                    },
                    delayed(
                        verb,
                        { $captured: { ref: "$sneak" } },
                        "$captured"
                    ),
                ]);
                expect(v.points).toBe(SAC_SELF_COST);
            });
        });
    }

    it("the sibling `sacrifice` reads the same alias as the same cost", () => {
        const v = lastOpValue([
            REVIVE_TOP,
            delayed(
                "sacrifice",
                { $captured: { ref: "$revived" } },
                "$captured"
            ),
        ]);
        expect(v.points).toBe(SAC_SELF_COST);
    });
});

describe("a permanent the script cannot call its own keeps the removal price (CR 701.13)", () => {
    for (const verb of VERBS) {
        describe(`${verb}`, () => {
            const price = OPPOSING_PRICE[verb];

            it("of an announced target", () => {
                expect(
                    valueOp({ op: verb, target: { target: 0 } }, cf).points
                ).toBe(price);
            });

            it("of a capture of an announced target", () => {
                const v = valueEffectScript(
                    [delayed(verb, { $it: { target: 0 } }, "$it")],
                    cf
                );
                expect(v.points).toBe(price);
                expect(v.tags).not.toContain("self-cost");
            });

            it("of an unbound or event-named ref", () => {
                for (const ref of ["$event.blockerId", "$unknown"]) {
                    expect(
                        valueOp({ op: verb, target: { ref } }, cf).points
                    ).toBe(price);
                }
            });

            it("of a card an announced `moveZone` returned to its OWNER", () => {
                const v = lastOpValue([
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "battlefield",
                        bind: "$back",
                    },
                    delayed(verb, { $c: { ref: "$back" } }, "$c"),
                ]);
                expect(v.points).toBe(roundToPointsGrid(price));
            });

            it("of a permanent the script gave to another player", () => {
                const v = lastOpValue([
                    {
                        op: "createTokenCopy",
                        source: { target: 0 },
                        controller: "opponent",
                        bind: "$copy",
                    },
                    delayed(verb, { $token: { ref: "$copy" } }, "$token"),
                ]);
                expect(v.points).toBe(roundToPointsGrid(price));
            });

            it("of the same name in a body that never captured it", () => {
                const v = lastOpValue([
                    REVIVE_TOP,
                    delayed(verb, { $other: { target: 0 } }, "$revived"),
                ]);
                expect(v.points).toBe(roundToPointsGrid(price));
            });
        });
    }
});
