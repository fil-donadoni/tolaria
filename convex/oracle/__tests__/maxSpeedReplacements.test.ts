// "Max speed — <replacement effect>" (CR 702.178a) and the same replacement
// sentences printed bare (CR 614.1a):
//   "If you would draw a card, draw two cards instead." (Vnwxt, Verbose Host;
//   bare: Thought Reflection)
//   "If a source you control would deal damage to an opponent or a permanent
//   an opponent controls, it deals that much damage plus 1 instead." (Far
//   Fortune, End Boss)
//
//  1. GRAMMAR — each line compiles to a `compiledReplacements` descriptor,
//     the max speed head surviving as its condition.
//  2. REFUSALS — the neighbours the anchored frames do not read.
//  3. ENGINE — the descriptor rebuilt by `expandDefinition`, the gate read
//     when the event is replaced (CR 702.179e: below max speed the event is
//     untouched), and two doublings compounding (CR 614.5).

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition, DamageReplacementEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyDamageReplacements } from "../../gre/replacements";
import { dealDamageFromPermanentToPlayer, planDrawStep } from "../../gre/state";
import type { GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";
const DRAW = "If you would draw a card, draw two cards instead.";
const DAMAGE =
    "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.";

function compiled(name: string, oracleText: string): CardDefinition {
    const outcome = compileCard(
        oracleCard({
            name,
            manaCost: "{2}{U}",
            typeLine: "Creature — Homunculus",
            oracleText,
            power: "2",
            toughness: "2",
        })
    );
    if (outcome.state !== "ready") throw new Error(`${name} ${outcome.state}`);
    return {
        ...outcome.definition,
        id: `test-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
        rarity: "rare",
    } as CardDefinition;
}

const VNWXT = compiled("Vnwxt Probe", `${REMINDER}\nMax speed — ${DRAW}`);
const FAR_FORTUNE = compiled(
    "Far Fortune Probe",
    `${REMINDER}\nMax speed — ${DAMAGE}`
);
const REFLECTION = compiled("Reflection Probe", DRAW);
const BEAR: CardDefinition = {
    id: "test-max-speed-replacement-bear",
    name: "Test Bear",
    rarity: "common",
    types: ["Creature"],
    power: 2,
    toughness: 2,
};

describe('"Max speed —" heading a replacement effect (CR 702.178a)', () => {
    it("the draw line: a draw-count descriptor behind the gate", () => {
        expect(sortKeys(VNWXT.compiledReplacements)).toEqual(
            sortKeys([
                {
                    kind: "draw-count",
                    id: "vnwxt-probe-draw-replacement",
                    oracleText: `Max speed — ${DRAW}`,
                    count: 2,
                    condition: { kind: "you-have-max-speed" },
                },
            ])
        );
    });

    it("the damage line: a damage-bonus descriptor behind the gate", () => {
        expect(sortKeys(FAR_FORTUNE.compiledReplacements)).toEqual(
            sortKeys([
                {
                    kind: "damage-bonus",
                    id: "far-fortune-probe-damage-bonus",
                    oracleText: `Max speed — ${DAMAGE}`,
                    amount: 1,
                    condition: { kind: "you-have-max-speed" },
                },
            ])
        );
    });

    it("the bare draw line compiles ungated (Thought Reflection)", () => {
        expect(REFLECTION.compiledReplacements).toEqual([
            {
                kind: "draw-count",
                id: "reflection-probe-draw-replacement",
                oracleText: DRAW,
                count: 2,
            },
        ]);
    });
});

describe("replacement frames — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string][] = [
        [
            "a step-scoped draw",
            "If you would draw a card during your draw step, draw two cards instead.",
        ],
        [
            "an exception",
            "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.",
        ],
        [
            "another player's draw",
            "If an opponent would draw a card, that player draws two cards instead.",
        ],
        ["a count of one", "If you would draw a card, draw one cards instead."],
        [
            "a coloured source (Torbran)",
            "If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.",
        ],
        [
            "another source (Thor)",
            "If another source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.",
        ],
        [
            "noncombat damage (Artist's Talent)",
            "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.",
        ],
        [
            "a bonus of zero",
            "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 0 instead.",
        ],
        ["two draw replacements on one card", `${DRAW}\n${DRAW}`],
    ];

    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            expect(
                compileCard(oracleCard({ name: "Test Card", oracleText: text }))
                    .state
            ).not.toBe("ready");
        });
});

describe("the rebuilt replacements read the gate as the event happens (CR 702.179e)", () => {
    it("expandDefinition rebuilds the descriptors and drops the field", () => {
        const draw = expandDefinition(VNWXT);
        expect(draw.compiledReplacements).toBeUndefined();
        expect(draw.drawReplacement?.outcome).toEqual({
            kind: "multiply-count",
            factor: 2,
        });
        const damage = expandDefinition(FAR_FORTUNE);
        expect(damage.compiledReplacements).toBeUndefined();
        expect(
            damage.replacementEffects?.map((r) => [
                r.id,
                r.eventKind,
                r.damageEffectKind,
            ])
        ).toEqual([["far-fortune-probe-damage-bonus", "damage", "other"]]);
    });

    function drawCount(
        defs: readonly CardDefinition[],
        speed: number | undefined
    ): number {
        const run = (): number => {
            const permanents = defs.map((def, i) =>
                makeInstance(def.id, { id: `src-${i}`, controllerId: "p1" })
            );
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: permanents,
                        ...(speed !== undefined ? { speed } : {}),
                    }),
                    makePlayer("p2"),
                ],
            });
            const plan = planDrawStep(state, "p1", 1, false);
            if (plan.kind !== "normal") throw new Error(plan.kind);
            return plan.count;
        };
        return defs.reduceRight<() => number>(
            (inner, def) => () =>
                withTemporaryDefinition(expandDefinition(def), inner),
            run
        )();
    }

    it("below max speed, one card; at max speed, two (Vnwxt)", () => {
        expect(drawCount([VNWXT], 3)).toBe(1);
        expect(drawCount([VNWXT], undefined)).toBe(1);
        expect(drawCount([VNWXT], 4)).toBe(2);
    });

    it("an opponent's draw is not the controller's (\"you would draw\")", () => {
        const run = withTemporaryDefinition(
            expandDefinition(REFLECTION),
            () => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(REFLECTION.id, {
                                    id: "src",
                                    controllerId: "p1",
                                }),
                            ],
                        }),
                        makePlayer("p2"),
                    ],
                });
                return planDrawStep(state, "p2", 1, false);
            }
        );
        expect(run).toEqual({ kind: "normal", count: 1 });
    });

    it("two doublings compound to four, not three (CR 614.5)", () => {
        const twin = { ...REFLECTION, id: `${REFLECTION.id}-twin` };
        expect(drawCount([REFLECTION, twin], undefined)).toBe(4);
        expect(drawCount([REFLECTION, VNWXT], 4)).toBe(4);
        expect(drawCount([REFLECTION, VNWXT], 3)).toBe(2);
    });

    function withDamageBoard<T>(
        speed: number | undefined,
        fn: (state: GameState) => T
    ): T {
        return withTemporaryDefinition(expandDefinition(FAR_FORTUNE), () =>
            withTemporaryDefinition(BEAR, () => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            life: 20,
                            battlefield: [
                                makeInstance(FAR_FORTUNE.id, {
                                    id: "far",
                                    controllerId: "p1",
                                }),
                                makeInstance(BEAR.id, {
                                    id: "my-bear",
                                    controllerId: "p1",
                                }),
                            ],
                            ...(speed !== undefined ? { speed } : {}),
                        }),
                        makePlayer("p2", {
                            life: 20,
                            battlefield: [
                                makeInstance(BEAR.id, {
                                    id: "their-bear",
                                    controllerId: "p2",
                                }),
                            ],
                        }),
                    ],
                });
                return fn(state);
            })
        );
    }

    function lifeAfter(
        speed: number | undefined,
        dealer: "p1" | "p2",
        victim: "p1" | "p2" = dealer === "p1" ? "p2" : "p1"
    ) {
        return withDamageBoard(speed, (state) => {
            const source = state.players
                .flatMap((p) => p.battlefield)
                .find((c) =>
                    dealer === "p1" ? c.id === "my-bear" : c.id === "their-bear"
                )!;
            dealDamageFromPermanentToPlayer(state, source, dealer, victim, 2);
            return state.players.find((p) => p.id === victim)!.life;
        });
    }

    it("damage to an opponent: unmodified below max speed, plus 1 at it", () => {
        expect(lifeAfter(3, "p1")).toBe(18);
        expect(lifeAfter(4, "p1")).toBe(17);
    });

    it("an opponent's source dealing damage to you is untouched", () => {
        expect(lifeAfter(4, "p2")).toBe(18);
    });

    it("your own source dealing damage to you is untouched", () => {
        expect(lifeAfter(4, "p1", "p1")).toBe(18);
    });

    function damageTo(target: string, speed: number): number | undefined {
        return withDamageBoard(speed, (state) => {
            const event: DamageReplacementEvent = {
                kind: "damage",
                sourceInstanceId: "my-bear",
                sourceControllerId: "p1",
                sourceColors: [],
                sourceTypes: ["Creature"],
                sourceStaticAbilities: [],
                target: { type: "permanent", id: target },
                amount: 3,
                isCombat: true,
            };
            return applyDamageReplacements(state, event)?.amount;
        });
    }

    it("a permanent an opponent controls takes plus 1; your own does not", () => {
        expect(damageTo("their-bear", 4)).toBe(4);
        expect(damageTo("their-bear", 3)).toBe(3);
        expect(damageTo("my-bear", 4)).toBe(3);
    });
});
