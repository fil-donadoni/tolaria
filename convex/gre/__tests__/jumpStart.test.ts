// Jump-start (CR 702.133): the whole keyword is CR 702.133a. Covers the cast
// permission and its additional cost through the real commit seams, the exile
// clause at every stack departure ("any time it would leave the stack", which
// flashback's CR 702.34a shares), mechanism precedence, serialization and the
// wire projection.
import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
    type StackItem,
} from "../state";
import { getLegalActions } from "../rules";
import { compactState, expandState } from "../serialize";
import { JUMP_START_COST_LEGS, hasJumpStart } from "../jumpStart";
import {
    announceCast,
    castExtraHandCostLegs,
    castRawManaCost,
    finalizeTargetSelection,
    flashbackStackFlags,
    locateCastSource,
    recordCastAlternativeHandCostPick,
    tryAutoCommitPendingCast,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { WRENN_AND_SIX_EMBLEM_ID } from "../../cards/emblems";
import {
    grizzlyBears,
    lightningBolt,
    wrathOfGod,
} from "../../cards/sets/lea/index.cards";
import { firebolt } from "../../cards/sets/ody/red.cards";

const KEYWORD = { staticAbilities: ["jump-start"] };
const JS_INSTANT: CardDefinition = {
    ...lightningBolt(),
    ...KEYWORD,
    id: "test-js-instant",
};
const JS_SORCERY: CardDefinition = {
    ...wrathOfGod(),
    ...KEYWORD,
    id: "test-js-sorcery",
};
const JS_CREATURE: CardDefinition = {
    ...grizzlyBears(),
    ...KEYWORD,
    id: "test-js-creature",
};

function inGraveyard(defId: string, id = "js") {
    return makeInstance(defId, {
        id,
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
}

function handCards(count: number) {
    return Array.from({ length: count }, (_, i) =>
        // Grizzly Bears, not a land: "discarding a card" has no type filter.
        makeInstance(grizzlyBears().id, {
            id: `hand-${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
}

function board(opts: {
    defId?: string;
    hand?: number;
    red?: number;
    white?: number;
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [inGraveyard(opts.defId ?? JS_INSTANT.id)],
                hand: handCards(opts.hand ?? 1),
                manaPool: {
                    W: opts.white ?? 0,
                    U: 0,
                    B: 0,
                    R: opts.red ?? 1,
                    G: 0,
                    C: 0,
                },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Casts the instant at p2 through `finalizeTargetSelection`, picking `hand-0`
 *  when the discard is a real choice. */
function castAtOpponent(state: GameState): StackItem {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "js",
        targetType: "any",
        count: 1,
        selected: [{ type: "player", id: "p2" }],
    };
    finalizeTargetSelection(state, pt, "p1");
    if (state.pendingCast) {
        recordCastAlternativeHandCostPick(state, "p1", ["hand-0"]);
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
    }
    const item = state.stack.find((s) => s.id === "js");
    expect(item).toBeDefined();
    return item!;
}

describe("Jump-start (CR 702.133a)", () => {
    describe("who has it", () => {
        it("an instant or sorcery with the keyword, through the definition", () => {
            for (const def of [JS_INSTANT, JS_SORCERY]) {
                withTemporaryDefinition(def, () => {
                    const state = board({ defId: def.id });
                    const card = getPlayer(state, "p1").graveyard[0];
                    expect(hasJumpStart(card)).toBe(true);
                });
            }
        });

        it('not a creature card: "if the resulting spell is an instant or sorcery spell"', () => {
            withTemporaryDefinition(JS_CREATURE, () => {
                const state = board({ defId: JS_CREATURE.id });
                const card = getPlayer(state, "p1").graveyard[0];
                expect(hasJumpStart(card)).toBe(false);
                expect(
                    locateCastSource(state, getPlayer(state, "p1"), card.id)
                        .viaJumpStart
                ).toBeUndefined();
            });
        });

        it("not an instant without the keyword", () => {
            const state = board({ defId: lightningBolt().id });
            const card = getPlayer(state, "p1").graveyard[0];
            expect(hasJumpStart(card)).toBe(false);
        });
    });

    describe("the cast affordance (getLegalActions)", () => {
        const legal = (state: GameState) => {
            const p1 = getPlayer(state, "p1");
            return getLegalActions(state, p1, p1.graveyard[0]);
        };

        it('offers "cast" with the mana and ANY card in hand, a nonland included', () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                expect(legal(board({}))).toContain("cast");
            });
        });

        it("refuses with an empty hand: the additional cost cannot be paid", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                expect(legal(board({ hand: 0 }))).not.toContain("cast");
            });
        });

        it("refuses when the printed mana cost cannot be paid", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                expect(legal(board({ red: 0 }))).not.toContain("cast");
            });
        });
    });

    describe("the cost", () => {
        it("keeps the PRINTED mana cost: the discard is additional, not alternative", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = board({});
                const src = locateCastSource(
                    state,
                    getPlayer(state, "p1"),
                    "js"
                );
                expect(src.zone).toBe("graveyard");
                expect(src.viaJumpStart).toBe(true);
                expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                    R: 1,
                });
            });
        });

        it("castExtraHandCostLegs folds the leg only for a jump-start cast", () => {
            expect(
                castExtraHandCostLegs(
                    undefined,
                    { viaJumpStart: true },
                    undefined
                )
            ).toEqual([JUMP_START_COST_LEGS]);
            expect(castExtraHandCostLegs(undefined, {}, undefined)).toEqual([]);
        });

        it("a targeted cast discards the picked card, and the other stays in hand", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = board({ hand: 2 });
                castAtOpponent(state);
                const p1 = getPlayer(state, "p1");
                expect(p1.hand.map((c) => c.id)).toEqual(["hand-1"]);
                expect(p1.graveyard.map((c) => c.id)).toEqual(["hand-0"]);
                expect(state.stack).toHaveLength(1);
            });
        });

        it("a NON-targeting cast through announceCast parks on the discard picker", async () => {
            type Args = {
                gameId: Id<"games">;
                playerId: string;
                cardInstanceId: string;
            };
            await withTemporaryDefinitionAsync(JS_SORCERY, async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(
                        board({
                            defId: JS_SORCERY.id,
                            hand: 2,
                            white: 4,
                            red: 0,
                        })
                    ),
                ]);
                await runMutation<Args, void>(
                    announceCast as unknown as Handler<Args, void>,
                    harness.ctx,
                    {
                        gameId: "game-1" as Id<"games">,
                        playerId: "p1",
                        cardInstanceId: "js",
                    }
                );
                const state = harness.state();
                expect(state.stack).toHaveLength(0);
                expect(state.pendingCast?.alternativeCostHandChoice).toEqual({
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                    excludeInstanceId: "js",
                });
                recordCastAlternativeHandCostPick(state, "p1", ["hand-1"]);
                expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
                expect(getPlayer(state, "p1").hand.map((c) => c.id)).toEqual([
                    "hand-0",
                ]);
                expect(state.stack[0].exileAnyTimeLeavesStack).toBe(true);
            });
        });
    });

    describe('exile "any time it would leave the stack"', () => {
        function onStack(): GameState {
            const state = board({ hand: 2 });
            castAtOpponent(state);
            return state;
        }

        const inExileOnly = (state: GameState) => {
            const p1 = getPlayer(state, "p1");
            expect(p1.exile.map((c) => c.id)).toEqual(["js"]);
            expect(p1.graveyard.some((c) => c.id === "js")).toBe(false);
            expect(p1.hand.some((c) => c.id === "js")).toBe(false);
            expect(p1.library.some((c) => c.id === "js")).toBe(false);
            expect(state.stack.some((s) => s.id === "js")).toBe(false);
        };

        /** A second spell, whose context performs the counter or the move. */
        function countererContext(state: GameState) {
            const counterer = {
                ...makeInstance(lightningBolt().id, {
                    id: "counterer",
                    zone: "stack",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                castById: "p2",
            } as StackItem;
            state.stack.push(counterer);
            return buildSpellContext(state, counterer);
        }

        it("resolving: the spell does its work, then is exiled", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = onStack();
                resolveTopOfStack(state);
                expect(getPlayer(state, "p2").life).toBe(17);
                inExileOnly(state);
            });
        });

        it("fizzling on an illegal target (CR 608.2b): exiled, no damage", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = onStack();
                state.stack[0].targets = [{ type: "permanent", id: "gone" }];
                resolveTopOfStack(state);
                inExileOnly(state);
            });
        });

        for (const destination of [
            "graveyard",
            "hand",
            "library-top",
        ] as const) {
            it(`countered with destination ${destination} (CR 701.6a): exiled`, () => {
                withTemporaryDefinition(JS_INSTANT, () => {
                    const state = onStack();
                    countererContext(state).counter(
                        { type: "spell", id: "js" },
                        destination
                    );
                    inExileOnly(state);
                });
            });
        }

        for (const destination of ["hand", "library-top"] as const) {
            it(`moved off the stack to ${destination}, not countered: exiled`, () => {
                withTemporaryDefinition(JS_INSTANT, () => {
                    const state = onStack();
                    countererContext(state).moveSpellFromStack(
                        { type: "spell", id: "js" },
                        destination
                    );
                    inExileOnly(state);
                });
            });
        }

        it("the same card cast from HAND owes no exile", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = board({ hand: 0 });
                const p1 = getPlayer(state, "p1");
                const card = p1.graveyard.pop()!;
                card.zone = "hand";
                p1.hand.push(card);
                castAtOpponent(state);
                expect(state.stack[0].exileAnyTimeLeavesStack).toBeUndefined();
                resolveTopOfStack(state);
                expect(p1.exile).toHaveLength(0);
                expect(p1.graveyard.map((c) => c.id)).toEqual(["js"]);
            });
        });

        it("survives a DB round-trip on the stack item", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = onStack();
                const round = expandState(compactState(state));
                expect(round.stack[0].exileAnyTimeLeavesStack).toBe(true);
            });
        });
    });

    describe("flashback shares the clause (CR 702.34a)", () => {
        function flashedBack(): GameState {
            const state = makeState({
                players: [makePlayer("p1"), makePlayer("p2")],
            });
            state.stack.push({
                ...makeInstance(firebolt().id, {
                    id: "fb",
                    zone: "stack",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
                castById: "p1",
                ...flashbackStackFlags("graveyard"),
            } as StackItem);
            return state;
        }

        it("a countered flashback spell is exiled, not put into the graveyard", () => {
            const state = flashedBack();
            const counterer = {
                ...makeInstance(lightningBolt().id, {
                    id: "counterer",
                    zone: "stack",
                    controllerId: "p2",
                    ownerId: "p2",
                }),
                castById: "p2",
            } as StackItem;
            state.stack.push(counterer);
            buildSpellContext(state, counterer).counter({
                type: "spell",
                id: "fb",
            });
            const p1 = getPlayer(state, "p1");
            expect(p1.exile.map((c) => c.id)).toEqual(["fb"]);
            expect(p1.graveyard).toHaveLength(0);
        });
    });

    describe("mechanism precedence", () => {
        it("a per-card graveyard grant claims it first: no discard owed, no exile", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = board({ hand: 2 });
                const p1 = getPlayer(state, "p1");
                p1.graveyard[0].castableFromGraveyardBy = "p1";
                expect(
                    locateCastSource(state, p1, "js").viaJumpStart
                ).toBeUndefined();
                const item = castAtOpponent(state);
                expect(p1.hand).toHaveLength(2);
                expect(item.exileAnyTimeLeavesStack).toBeUndefined();
                resolveTopOfStack(state);
                expect(p1.exile).toHaveLength(0);
            });
        });

        it("documented deviation: under a retrace grant the card is cast under retrace", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const state = board({});
                state.emblems = [
                    {
                        id: "emblem-p1",
                        ownerId: "p1",
                        emblemId: WRENN_AND_SIX_EMBLEM_ID,
                        name: "Wrenn and Six emblem",
                        text: "Instant and sorcery cards in your graveyard have retrace.",
                    },
                ];
                const src = locateCastSource(
                    state,
                    getPlayer(state, "p1"),
                    "js"
                );
                expect(src.viaRetrace).toBe(true);
                expect(src.viaJumpStart).toBeUndefined();
            });
        });
    });

    describe("frontend wiring: projectPublicState tags the affordance", () => {
        it('tags the viewer\'s own card castKind: "jump-start" with legalActions', () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const projected = projectPublicState(board({}), 1, "p1");
                const card = projected.players[0].graveyard[0];
                expect(card.castKind).toBe("jump-start");
                expect(card.legalActions).toContain("cast");
            });
        });

        it("keeps the tag with no legal cast, so the button explains itself", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const projected = projectPublicState(
                    board({ hand: 0 }),
                    1,
                    "p1"
                );
                const card = projected.players[0].graveyard[0];
                expect(card.castKind).toBe("jump-start");
                expect(card.legalActions).not.toContain("cast");
            });
        });

        it("never tags the opponent's view of the card", () => {
            withTemporaryDefinition(JS_INSTANT, () => {
                const projected = projectPublicState(board({}), 1, "p2");
                const card = projected.players[0].graveyard[0];
                expect(card.castKind).toBeUndefined();
                expect(card.legalActions).toBeUndefined();
            });
        });
    });
});
