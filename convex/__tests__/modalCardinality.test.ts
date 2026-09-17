/**
 * Modal cardinality on the announce-time mode list (ADR 0094, issue #2263) —
 * CR 700.2a / 700.2d / 608.2c / 609.3, driven through the REAL cast path: the
 * `announceCast` and `selectTargets` mutation handlers, `resolveTopOfStack`,
 * and the Pending Choice submit. No shipped card declares a `modeSelection`
 * yet (issue #2266 ships them), so every test registers a variant of Hull
 * Breach whose mode list carries one.
 */

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { hullBreach } from "../cards/sets/pls/multicolor";
import { grizzlyBears, plains } from "../cards/sets/lea";
import { fork, hillGiant } from "../cards/sets/lea/red";
import { prodigalSorcerer } from "../cards/sets/lea/blue";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../cards";
import type { CardDefinition, ModeSelection, SpellMode } from "../cards/types";
import { announceCast, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness";
import type { Id } from "../_generated/dataModel";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../gre/state";
import { applyPendingChoiceSubmit } from "../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../gre/serialize";

const PING: SpellMode = {
    id: "ping",
    label: "1 damage to target creature",
    oracleText: "This spell deals 1 damage to target creature.",
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};
const DRAW: SpellMode = {
    id: "draw",
    label: "Draw a card",
    oracleText: "Draw a card.",
    effects: [{ op: "draw", player: "controller", count: 1 }],
};
const DISCARD: SpellMode = {
    id: "discard",
    label: "Put a card from your hand into your graveyard",
    oracleText: "Put a card from your hand into your graveyard.",
    effects: [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 1,
            prompt: "Choose a card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "graveyard",
        },
    ],
};

/** A free sorcery whose mode list is PING, DRAW, DISCARD in that printed
 *  order, with the given cardinality. */
function probe(modeSelection: ModeSelection | undefined): CardDefinition {
    return {
        ...hullBreach,
        manaCost: {},
        modes: [PING, DRAW, DISCARD],
        ...(modeSelection ? { modeSelection } : {}),
    };
}

const SPELL = "probe-1";

function creature(
    cardId: string,
    id: string,
    owner: string
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });
}

function board(opts: {
    oppCreatures?: CardInstanceState[];
    myBattlefield?: CardInstanceState[];
    extraHand?: CardInstanceState[];
}): GameState {
    const spell = makeInstance(hullBreach.id, {
        id: SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const library = Array.from({ length: 5 }, (_, i) =>
        makeInstance(plains.id, {
            id: `lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell, ...(opts.extraHand ?? [])],
                library,
                battlefield: opts.myBattlefield ?? [],
            }),
            makePlayer("p2", { battlefield: opts.oppCreatures ?? [] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    chosenModeIds: string[]
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, cardInstanceId: SPELL, chosenModeIds }
    );
}

async function target(
    harness: ReturnType<typeof makeMutationCtx>,
    ids: string[]
): Promise<void> {
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            targets: ids.map((id) => ({
                targetType: "permanent",
                targetId: id,
            })),
        }
    );
}

function top(state: GameState): StackItem {
    const item = state.stack[state.stack.length - 1];
    if (!item) throw new Error("stack is empty");
    return item;
}

describe("ModeSelection — announcement bounds (CR 700.2a / 700.2d)", () => {
    it("absent modeSelection still announces exactly one mode", async () => {
        await withTemporaryDefinitionAsync(probe(undefined), async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(board({}))]);
            await expect(
                announce(harness, ["draw", "discard"])
            ).rejects.toThrow(/at most 1 mode/);
            await announce(harness, ["draw"]);
            expect(top(harness.state()).chosenModeIds).toEqual(["draw"]);
            expect(top(harness.state()).modeTargetCounts).toBeUndefined();
        });
    });

    it("rejects a repeated mode unless the list allows repeats (CR 700.2d)", async () => {
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 2 }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(board({})),
                ]);
                await expect(
                    announce(harness, ["draw", "draw"])
                ).rejects.toThrow(/more than once/);
            }
        );
    });

    it("rejects fewer modes than the minimum while enough are legal", async () => {
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 2 }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(
                        board({
                            oppCreatures: [
                                creature(grizzlyBears.id, "bears", "p2"),
                            ],
                        })
                    ),
                ]);
                await expect(announce(harness, ["draw"])).rejects.toThrow(
                    /at least 2 mode/
                );
            }
        );
    });

    it("CR 609.3 — announces with as many modes as can legally be chosen", async () => {
        // Choose three of three, no repeats, but PING has no legal target (no
        // creature anywhere): CR 700.2a forbids it, so two modes is all that
        // can be done.
        await withTemporaryDefinitionAsync(
            probe({ min: 3, max: 3 }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(
                        board({
                            extraHand: [
                                makeInstance(plains.id, {
                                    id: "h1",
                                    controllerId: "p1",
                                    ownerId: "p1",
                                    zone: "hand",
                                }),
                            ],
                        })
                    ),
                ]);
                await expect(announce(harness, ["draw"])).rejects.toThrow(
                    /at least 3 mode/
                );
                await announce(harness, ["discard", "draw"]);
                expect(top(harness.state()).chosenModeIds).toEqual([
                    "draw",
                    "discard",
                ]);
            }
        );
    });

    it("a conditional count reads the board at announcement (controls a Wizard)", async () => {
        const selection: ModeSelection = {
            min: 1,
            max: 1,
            when: {
                condition: { controls: { subtypes: ["Wizard"] } },
                min: 1,
                max: 2,
            },
        };
        await withTemporaryDefinitionAsync(probe(selection), async () => {
            const without = makeMutationCtx("p1", [gameStateSeed(board({}))]);
            await expect(
                announce(without, ["draw", "discard"])
            ).rejects.toThrow(/at most 1 mode/);

            const withWizard = makeMutationCtx("p1", [
                gameStateSeed(
                    board({
                        myBattlefield: [
                            creature(prodigalSorcerer.id, "wiz", "p1"),
                        ],
                    })
                ),
            ]);
            await announce(withWizard, ["draw", "discard"]);
            expect(top(withWizard.state()).chosenModeIds).toEqual([
                "draw",
                "discard",
            ]);
        });
    });
});

describe("mode instances — targets, order, resolution (CR 608.2c / 700.2d)", () => {
    it("normalises click order to printed order and gives each instance its own target span", async () => {
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 3, repeats: true }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(
                        board({
                            oppCreatures: [
                                creature(grizzlyBears.id, "bears", "p2"),
                                creature(hillGiant.id, "giant", "p2"),
                            ],
                        })
                    ),
                ]);
                // Clicked draw first; printed order puts both pings first.
                await announce(harness, ["draw", "ping", "ping"]);
                const pt = harness.state().pendingTarget!;
                expect(pt.chosenModeIds).toEqual(["ping", "ping", "draw"]);
                expect(pt.groupModeInstances).toEqual([0, 1]);

                await target(harness, ["bears", "giant"]);
                const state = harness.state();
                const item = top(state);
                expect(item.chosenModeIds).toEqual(["ping", "ping", "draw"]);
                expect(item.modeTargetCounts).toEqual([1, 1, 0]);
                expect(item.targets?.map((t) => t.id)).toEqual([
                    "bears",
                    "giant",
                ]);

                const handBefore = state.players[0].hand.length;
                resolveTopOfStack(state);
                // Each ping read ITS OWN `{ target: 0 }` — without the offset
                // both would have hit the Bears.
                const opp = state.players[1].battlefield;
                expect(opp.find((c) => c.id === "bears")?.damageMarked).toBe(1);
                expect(opp.find((c) => c.id === "giant")?.damageMarked).toBe(1);
                expect(state.players[0].hand.length).toBe(handBefore + 1);
            }
        );
    });

    it("repeated instances may share one target (CR 700.2d)", async () => {
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 2, repeats: true }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(
                        board({
                            oppCreatures: [
                                creature(hillGiant.id, "giant", "p2"),
                            ],
                        })
                    ),
                ]);
                await announce(harness, ["ping", "ping"]);
                await target(harness, ["giant", "giant"]);
                const state = harness.state();
                expect(top(state).modeTargetCounts).toEqual([1, 1]);
                resolveTopOfStack(state);
                expect(
                    state.players[1].battlefield.find((c) => c.id === "giant")
                        ?.damageMarked
                ).toBe(2);
            }
        );
    });

    it("a repeated mode's choice suspends and prompts afresh per instance (CR 700.2d)", async () => {
        const hand = ["h1", "h2"].map((id) =>
            makeInstance(plains.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 2, repeats: true }),
            async () => {
                const harness = makeMutationCtx("p1", [
                    gameStateSeed(board({ extraHand: hand })),
                ]);
                await announce(harness, ["discard", "discard"]);
                // Round-trip through the store between every step, as a real
                // game does at each stable point.
                let state = expandState(compactState(harness.state()));
                resolveTopOfStack(state);
                for (const pick of ["h1", "h2"]) {
                    const head = state.pendingChoices?.[0];
                    expect(head?.kind).toBe("choose-hand-card");
                    state = expandState(compactState(state));
                    const choice = state.pendingChoices![0];
                    applyPendingChoiceSubmit(state, {
                        playerId: choice.playerId,
                        stackItemId: choice.stackItemId,
                        step: choice.step,
                        choiceId: choice.choiceId,
                        cardInstanceIds: [pick],
                    });
                }
                expect(state.pendingChoices ?? []).toHaveLength(0);
                expect(
                    state.players[0].graveyard.map((c) => c.id).sort()
                ).toEqual(expect.arrayContaining(["h1", "h2"]));
                expect(state.players[0].hand.map((c) => c.id)).toEqual([]);
            }
        );
    });
});

describe("copies (CR 700.2g)", () => {
    it("a copy carries every chosen mode instance and its target spans", async () => {
        await withTemporaryDefinitionAsync(
            probe({ min: 2, max: 2, repeats: true }),
            async () => {
                const state = board({
                    oppCreatures: [
                        creature(grizzlyBears.id, "bears", "p2"),
                        creature(hillGiant.id, "giant", "p2"),
                    ],
                });
                const spell = state.players[0].hand.pop()!;
                state.stack.push({
                    ...spell,
                    zone: "stack",
                    castById: "p1",
                    chosenModeIds: ["ping", "ping"],
                    modeTargetCounts: [1, 1],
                    targets: [
                        { type: "permanent", id: "bears" },
                        { type: "permanent", id: "giant" },
                    ],
                });
                state.stack.push({
                    ...makeInstance(fork.id, {
                        id: "fork-1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "stack",
                    }),
                    castById: "p1",
                    targets: [{ type: "spell", id: SPELL }],
                });
                resolveTopOfStack(state);
                const copy = top(state);
                expect(copy.isCopy).toBe(true);
                expect(copy.chosenModeIds).toEqual(["ping", "ping"]);
                expect(copy.modeTargetCounts).toEqual([1, 1]);
                resolveTopOfStack(state);
                const opp = state.players[1].battlefield;
                expect(opp.find((c) => c.id === "bears")?.damageMarked).toBe(1);
                expect(opp.find((c) => c.id === "giant")?.damageMarked).toBe(1);
            }
        );
    });
});

describe("the permanent domain (CR 700.2, ADR 0094)", () => {
    it("a resolving modal permanent spell stores its first announced mode as chosenModeId", () => {
        const modalBears: CardDefinition = {
            ...grizzlyBears,
            modes: [
                { id: "x", label: "x", oracleText: "x" },
                { id: "y", label: "y", oracleText: "y" },
            ],
        };
        withTemporaryDefinition(modalBears, () => {
            const state = board({});
            state.stack.push({
                ...makeInstance(grizzlyBears.id, {
                    id: "modal-bears",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "stack",
                }),
                castById: "p1",
                chosenModeIds: ["y"],
            });
            resolveTopOfStack(state);
            const entered = state.players[0].battlefield.find(
                (c) => c.id === "modal-bears"
            )!;
            expect(entered.chosenModeId).toBe("y");
            expect(
                (entered as { chosenModeIds?: string[] }).chosenModeIds
            ).toBeUndefined();
        });
    });

    it("a spell leaving the stack for a graveyard drops a stale permanent-domain mode (CR 400.7)", () => {
        const state = board({});
        const spell = state.players[0].hand.pop()!;
        state.stack.push({
            ...spell,
            ...({ chosenModeId: "stale" } as object),
            zone: "stack",
            castById: "p1",
            chosenModeIds: ["draw"],
        });
        resolveTopOfStack(state);
        const gy = state.players[0].graveyard.find((c) => c.id === SPELL)!;
        expect(gy.chosenModeId).toBeUndefined();
    });
});

describe("serialization — chosenModeIds / modeTargetCounts (ADR 0094)", () => {
    function modalItem(extra: Partial<StackItem>): GameState {
        const state = board({});
        const spell = state.players[0].hand.pop()!;
        state.stack = [{ ...spell, zone: "stack", castById: "p1", ...extra }];
        return state;
    }

    it("round-trips the instance list and its spans", () => {
        const state = modalItem({
            chosenModeIds: ["artifact", "artifact"],
            modeTargetCounts: [1, 1],
        });
        const item = expandState(compactState(state)).stack[0];
        expect(item.chosenModeIds).toEqual(["artifact", "artifact"]);
        expect(item.modeTargetCounts).toEqual([1, 1]);
    });

    it("reads a legacy singular chosenModeId on a modal spell back as one instance", () => {
        const compact = compactState(modalItem({}));
        const row = (compact.stack as Record<string, unknown>[])[0];
        row.chosenModeId = "enchantment";
        const item = expandState(compact).stack[0];
        expect(item.chosenModeIds).toEqual(["enchantment"]);
    });

    it("promotes a legacy singular chosenModeId on a pending announcement", () => {
        const state = board({});
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: SPELL,
            targetType: "Artifact",
            count: 1,
            selected: [],
            chosenModeIds: ["x"],
        };
        const compact = compactState(state);
        const pt = compact.pendingTarget as Record<string, unknown>;
        delete pt.chosenModeIds;
        pt.chosenModeId = "artifact";
        const expanded = expandState(compact).pendingTarget as Record<
            string,
            unknown
        >;
        expect(expanded.chosenModeIds).toEqual(["artifact"]);
        expect(expanded.chosenModeId).toBeUndefined();
    });

    it("does not mistake a legacy id that names no announce-time mode for one", () => {
        const compact = compactState(modalItem({}));
        const row = (compact.stack as Record<string, unknown>[])[0];
        row.chosenModeId = "W";
        const item = expandState(compact).stack[0];
        expect(item.chosenModeIds).toBeUndefined();
    });
});
