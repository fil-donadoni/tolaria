// "If you would draw a card during your draw step, instead you may skip that
// draw. If you do, <body>." (CR 614.1a) and "If you would begin your draw
// step, you may skip that step instead. If you do, <body>." (CR 614.10) — the
// optional draw-skip frame's two openings.
//
// Four layers, each watching a different way the frame can go wrong:
//
//  1. GOLDEN — Island Sanctuary compiled whole, and Fasting's draw-step line,
//     must produce exactly the hand-written shape: the draw-step flag plus a
//     DRAW trigger holding a yes/no `optionChoice` whose "no" branch draws.
//  2. ROUND TRIP — the real catalogue card reads back to itself (Guard C).
//  3. REFUSALS — neighbours of both openings stay unparsed: other openings,
//     other bodies, trailing text.
//  4. BEHAVIOUR — the compiled definitions, registered as-is, suppress the
//     turn-based draw, offer the choice at the draw step, and the "yes"
//     answer runs the body while "no" draws.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { islandSanctuary } from "../../cards/sets/lea/white.cards";
import { advancePhase } from "../../gre/phases";
import { resolveTopOfStack } from "../../gre/state";
import type { GameState } from "../../gre/state";
import { compileCard } from "../compile";
import { roundTripCard } from "../gold";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const BODY =
    "until your next turn, you can't be attacked except by creatures with flying and/or islandwalk";
const ISLAND_SANCTUARY_TEXT = `If you would draw a card during your draw step, instead you may skip that draw. If you do, ${BODY}.`;

const FASTING_STEP_TEXT =
    "If you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.";

/** Fasting's draw-step line alone: its upkeep and draw-trigger lines are other
 *  Grammar Gaps, so the whole card does not compile yet. */
const FASTING_STEP_LINE = oracleCard({
    oracleId: "0d787c6b-ab82-42c5-b840-8f3a09af30ac",
    name: "Fasting",
    manaCost: "{W}",
    typeLine: "Enchantment",
    oracleText: FASTING_STEP_TEXT,
    power: undefined,
    toughness: undefined,
});

const ISLAND_SANCTUARY = oracleCard({
    oracleId: "7d1769d0-d942-45b3-a31c-2bbe45e68661",
    name: "Island Sanctuary",
    manaCost: "{1}{W}{W}",
    typeLine: "Enchantment",
    oracleText: ISLAND_SANCTUARY_TEXT,
    power: undefined,
    toughness: undefined,
});

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

function withText(oracleText: string) {
    return oracleCard({
        typeLine: "Enchantment",
        power: undefined,
        toughness: undefined,
        oracleText,
    });
}

describe("Optional draw skip — golden fixture (CR 614.1a)", () => {
    it("Island Sanctuary: the flag, and a DRAW trigger offering skip-or-draw", () => {
        expect(sortKeys(compiled(ISLAND_SANCTUARY))).toEqual(
            sortKeys({
                name: "Island Sanctuary",
                types: ["Enchantment"],
                manaCost: { X: 1, W: 2 },
                oracleText: ISLAND_SANCTUARY_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "island-sanctuary-draw-choice",
                        oracleText: ISLAND_SANCTUARY_TEXT,
                        head: { kind: "phase", phase: "DRAW", scope: "your" },
                        effects: [
                            {
                                op: "optionChoice",
                                prompt: "Skip your draw? (Island Sanctuary)",
                                modes: [
                                    {
                                        id: "yes",
                                        label: "Skip the draw",
                                        effects: [
                                            {
                                                op: "restrictAttackers",
                                                player: "controller",
                                            },
                                        ],
                                    },
                                    {
                                        id: "no",
                                        label: "Draw a card",
                                        effects: [
                                            {
                                                op: "draw",
                                                player: "controller",
                                                count: 1,
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
                drawStepReplacement: true,
            })
        );
    });

    it("Fasting's draw-step line: the flag, and a DRAW trigger offering skip-step-or-draw (CR 614.10)", () => {
        expect(sortKeys(compiled(FASTING_STEP_LINE))).toEqual(
            sortKeys({
                name: "Fasting",
                types: ["Enchantment"],
                manaCost: { W: 1 },
                oracleText: FASTING_STEP_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "fasting-draw-choice",
                        oracleText: FASTING_STEP_TEXT,
                        head: { kind: "phase", phase: "DRAW", scope: "your" },
                        effects: [
                            {
                                op: "optionChoice",
                                prompt: "Skip your draw step? (Fasting)",
                                modes: [
                                    {
                                        id: "yes",
                                        label: "Skip the draw step",
                                        effects: [
                                            {
                                                op: "gainLife",
                                                player: "controller",
                                                amount: 2,
                                            },
                                        ],
                                    },
                                    {
                                        id: "no",
                                        label: "Draw a card",
                                        effects: [
                                            {
                                                op: "draw",
                                                player: "controller",
                                                count: 1,
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
                drawStepReplacement: true,
            })
        );
    });

    it("routes the two-sentence line to the static slot as one clause", () => {
        const routed = routeLine(ISLAND_SANCTUARY_TEXT, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
        const parsed = staticSlot.run(ISLAND_SANCTUARY_TEXT, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "optional-draw-skip",
                skips: "draw",
                effects: [{ kind: "player-attack-protection" }],
            });
    });

    it("reads Fasting's opening as the skipped STEP, not the skipped draw", () => {
        const parsed = staticSlot.run(FASTING_STEP_TEXT, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toMatchObject({
                kind: "optional-draw-skip",
                skips: "step",
            });
    });

    it("the hand-written catalogue card's own text compiles (Guard C)", () => {
        // The catalogue card carries a closure trigger (`phaseTrigger`), so
        // the comparator reports it `incomparable`: producing a definition at
        // all is the verdict a closure card owes (`gold.ts`).
        expect(roundTripCard(islandSanctuary()).verdict.ok).toBe(true);
    });
});

describe("Optional draw skip — refusals (fail-closed neighbours)", () => {
    const refused = [
        // Other openings.
        `If you would draw a card, instead you may skip that draw. If you do, ${BODY}.`,
        `If you would draw a card during your draw step, you may skip that draw instead. If you do, ${BODY}.`,
        `If you would draw a card during your draw step, instead skip that draw. If you do, ${BODY}.`,
        // The opening alone gates no effect.
        "If you would draw a card during your draw step, instead you may skip that draw.",
        // Neighbours of the body.
        "If you would draw a card during your draw step, instead you may skip that draw. If you do, until end of turn, you can't be attacked except by creatures with flying and/or islandwalk.",
        "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, you can't be attacked except by creatures with flying.",
        "If you would draw a card during your draw step, instead you may skip that draw. If you do, until your next turn, creatures can't attack you.",
        // A target is announced before the skip-or-draw answer (CR 603.3d).
        "If you would draw a card during your draw step, instead you may skip that draw. If you do, destroy target creature.",
        // Trailing text is never swallowed.
        `${ISLAND_SANCTUARY_TEXT} Draw a card.`,
        // Neighbours of the step opening (CR 614.10).
        "If you would begin your draw step, instead you may skip that step. If you do, you gain 2 life.",
        "If you would begin your draw step, skip that step instead. If you do, you gain 2 life.",
        "If you would begin your upkeep step, you may skip that step instead. If you do, you gain 2 life.",
        "If you would begin your draw step, you may skip that step instead.",
        "If you would begin your draw step, you may skip that step instead. If you do, destroy target creature.",
        `${FASTING_STEP_TEXT} Draw a card.`,
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(compileCard(withText(line)).state).not.toBe("ready");
        });
    }
});

describe("Optional draw skip — lowering invariants", () => {
    it("is JSON-pure: a flag and one trigger descriptor, no static effect", () => {
        const definition = compiled(ISLAND_SANCTUARY);
        expect(definition.drawStepReplacement).toBe(true);
        expect(definition.compiledTriggeredAbilities).toHaveLength(1);
        expect(definition.compiledStaticEffects).toBeUndefined();
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });

    it("a card that prints no such sentence carries neither flag nor trigger", () => {
        const definition = compiled(
            oracleCard({
                oracleText: "Flying",
                typeLine: "Creature — Bird",
            })
        );
        expect(definition.drawStepReplacement).toBeUndefined();
        expect(definition.compiledTriggeredAbilities).toBeUndefined();
    });
});

/** Register a compiled definition under `id` for the duration of `fn`. */
function withCompiled<T>(
    card: ReturnType<typeof oracleCard>,
    id: string,
    fn: () => T
): T {
    const definition: CardDefinition = {
        ...compiled(card),
        id,
        rarity: "rare",
    };
    return withTemporaryDefinition(definition, fn);
}

/** p1's turn 2: UPKEEP → DRAW with `id` in play and one card on top of the
 *  library. */
function drawStep(id: string) {
    const p1 = makePlayer("p1", {
        battlefield: [
            makeInstance(id, {
                id: "source",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ],
        library: [makeInstance(id, { id: "top" })],
    });
    const state = makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        turn: 2,
        phase: "UPKEEP",
    });
    advancePhase(state);
    return { state, p1 };
}

function answer(state: GameState, mode: "yes" | "no") {
    resolveTopOfStack(state);
    const queue = state.pendingChoices ?? [];
    const head = queue[0]!;
    const item = state.stack.find((s) => s.id === head.stackItemId)!;
    item.collectedChoices = {
        ...(item.collectedChoices ?? {}),
        [`${head.step}:${head.choiceId}`]: [mode],
    };
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    resolveTopOfStack(state);
}

describe("Optional draw skip — the compiled definition at the real draw step (CR 504.1)", () => {
    const SANCTUARY_ID = "compiled-island-sanctuary";
    const withSanctuary = <T>(fn: () => T): T =>
        withCompiled(ISLAND_SANCTUARY, SANCTUARY_ID, fn);

    it("the turn-based draw is suppressed and the choice is put on the stack", () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep(SANCTUARY_ID);
            expect(state.phase).toBe("DRAW");
            expect(p1.hand).toHaveLength(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    it('"yes" skips the draw and arms the attack protection', () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep(SANCTUARY_ID);
            answer(state, "yes");
            expect(state.playerAttackRequirements).toBe("p1");
            expect(p1.hand).toHaveLength(0);
        });
    });

    it('"no" draws the replaced card and arms nothing', () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep(SANCTUARY_ID);
            answer(state, "no");
            expect(state.playerAttackRequirements).toBeUndefined();
            expect(p1.hand).toHaveLength(1);
        });
    });
});

describe("Optional draw skip — Fasting's step opening at the real draw step (CR 614.10)", () => {
    const FASTING_ID = "compiled-fasting-step";
    const withFasting = <T>(fn: () => T): T =>
        withCompiled(FASTING_STEP_LINE, FASTING_ID, fn);

    it("the turn-based draw is suppressed and the choice is put on the stack", () => {
        withFasting(() => {
            const { state, p1 } = drawStep(FASTING_ID);
            expect(state.phase).toBe("DRAW");
            expect(p1.hand).toHaveLength(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    it('"yes" skips the step\'s draw and gains 2 life', () => {
        withFasting(() => {
            const { state, p1 } = drawStep(FASTING_ID);
            const life = p1.life;
            answer(state, "yes");
            expect(p1.life).toBe(life + 2);
            expect(p1.hand).toHaveLength(0);
        });
    });

    it('"no" draws the card and gains nothing', () => {
        withFasting(() => {
            const { state, p1 } = drawStep(FASTING_ID);
            const life = p1.life;
            answer(state, "no");
            expect(p1.life).toBe(life);
            expect(p1.hand).toHaveLength(1);
        });
    });
});
