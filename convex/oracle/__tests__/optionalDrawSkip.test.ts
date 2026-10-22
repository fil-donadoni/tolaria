// "If you would draw a card during your draw step, instead you may skip that
// draw. If you do, <body>." — the optional draw-skip frame (CR 614.1a, issue
// #6327).
//
// Four layers, each watching a different way the frame can go wrong:
//
//  1. GOLDEN — Island Sanctuary compiled whole must produce exactly the
//     hand-written shape: the draw-step flag plus a DRAW trigger holding a
//     yes/no `optionChoice` whose "no" branch draws the replaced card.
//  2. ROUND TRIP — the real catalogue card reads back to itself (Guard C).
//  3. REFUSALS — neighbours of the sentence stay unparsed: Fasting's step
//     replacement (CR 614.10), other openings, other bodies, trailing text.
//  4. BEHAVIOUR — the compiled definition, registered as-is, suppresses the
//     turn-based draw, offers the choice at the draw step, and the "yes"
//     answer arms the attack protection while "no" draws.

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
                                                op: "setIslandSanctuaryProtection",
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

    it("routes the two-sentence line to the static slot as one clause", () => {
        const routed = routeLine(ISLAND_SANCTUARY_TEXT, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
        const parsed = staticSlot.run(ISLAND_SANCTUARY_TEXT, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "optional-draw-skip",
                effects: [{ kind: "player-attack-protection" }],
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
        // Fasting's opening replaces the STEP (CR 614.10), not a draw.
        `If you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.`,
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
        // Trailing text is never swallowed.
        `${ISLAND_SANCTUARY_TEXT} Draw a card.`,
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

describe("Optional draw skip — the compiled definition at the real draw step (CR 504.1)", () => {
    const SANCTUARY_ID = "compiled-island-sanctuary";

    function withSanctuary<T>(fn: () => T): T {
        const definition: CardDefinition = {
            ...compiled(ISLAND_SANCTUARY),
            id: SANCTUARY_ID,
            rarity: "rare",
        };
        return withTemporaryDefinition(definition, fn);
    }

    /** p1's turn 2: UPKEEP → DRAW with one card on top of the library. */
    function drawStep() {
        const p1 = makePlayer("p1", {
            battlefield: [
                makeInstance(SANCTUARY_ID, {
                    id: "sanc",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
            library: [makeInstance(SANCTUARY_ID, { id: "top" })],
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

    it("the turn-based draw is suppressed and the choice is put on the stack", () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep();
            expect(state.phase).toBe("DRAW");
            expect(p1.hand).toHaveLength(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    it('"yes" skips the draw and arms the attack protection', () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep();
            answer(state, "yes");
            expect(state.islandSanctuaryProtection).toBe("p1");
            expect(p1.hand).toHaveLength(0);
        });
    });

    it('"no" draws the replaced card and arms nothing', () => {
        withSanctuary(() => {
            const { state, p1 } = drawStep();
            answer(state, "no");
            expect(state.islandSanctuaryProtection).toBeUndefined();
            expect(p1.hand).toHaveLength(1);
        });
    });
});
