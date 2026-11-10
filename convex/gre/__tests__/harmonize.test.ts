// Harmonize (CR 702.180): the graveyard cast for the harmonize cost, the
// reduction by the power of up to one tapped creature (chosen at announcement,
// CR 702.180b), and the exile any time the spell leaves the stack — through the
// real commit seams, the castability gate, the mutation's validation and the
// wire projection.
import { describe, it, expect } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../state";
import { getLegalActions } from "../rules";
import { graveyardCastMechanism } from "../castCost";
import {
    hasHarmonize,
    harmonizeReductionFor,
    largestHarmonizeReduction,
} from "../harmonize";
import {
    announceCast,
    castRawManaCost,
    finalizeTargetSelection,
    locateCastSource,
    tryAutoCommitPendingCast,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState } from "../state/declarations";
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
import {
    crawWurm,
    grizzlyBears,
    hillGiant,
    lightningBolt,
    wrathOfGod,
} from "../../cards/sets/lea/index.cards";

/** A targeted instant: Lightning Bolt with "Harmonize {3}{R}". */
const HZ_INSTANT: CardDefinition = {
    ...lightningBolt(),
    id: "test-hz-instant",
    harmonize: { X: 3, R: 1 },
};
/** An untargeted sorcery: Wrath of God with "Harmonize {4}{W}". */
const HZ_SORCERY: CardDefinition = {
    ...wrathOfGod(),
    id: "test-hz-sorcery",
    harmonize: { X: 4, W: 1 },
};

function creature(
    defId: string,
    id: string,
    over: Partial<CardInstanceState> = {}
) {
    return makeInstance(defId, {
        id,
        zone: "battlefield",
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });
}

function board(opts: {
    defId?: string;
    red?: number;
    white?: number;
    battlefield?: CardInstanceState[];
    opponentBattlefield?: CardInstanceState[];
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(opts.defId ?? HZ_INSTANT.id, {
                        id: "hz",
                        zone: "graveyard",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: opts.battlefield ?? [],
                manaPool: {
                    W: opts.white ?? 0,
                    U: 0,
                    B: 0,
                    R: opts.red ?? 0,
                    G: 0,
                    C: 0,
                },
            }),
            makePlayer("p2", { battlefield: opts.opponentBattlefield ?? [] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function legal(state: GameState) {
    const p1 = getPlayer(state, "p1");
    return getLegalActions(state, p1, p1.graveyard[0]);
}

/** The instant at p2 through `finalizeTargetSelection`, tapping `creatureId`. */
function castAtOpponent(state: GameState, creatureId?: string) {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "hz",
        targetType: "any",
        count: 1,
        selected: [{ type: "player", id: "p2" }],
        ...(creatureId ? { harmonizeTapCreatureId: creatureId } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
}

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    harmonizeCreatureId?: string;
};

async function announce(state: GameState, harmonizeCreatureId?: string) {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "hz",
            ...(harmonizeCreatureId ? { harmonizeCreatureId } : {}),
        }
    );
    return harness.state();
}

describe("Harmonize (CR 702.180)", () => {
    describe("the graveyard cast for the harmonize cost (CR 702.180a)", () => {
        it("is the harmonize mechanism, located in the graveyard, priced at the harmonize cost", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({});
                const p1 = getPlayer(state, "p1");
                const card = p1.graveyard[0];
                expect(hasHarmonize(card)).toBe(true);
                expect(graveyardCastMechanism(state, p1, card, "p1")).toBe(
                    "harmonize"
                );
                const src = locateCastSource(state, p1, "hz");
                expect(src.zone).toBe("graveyard");
                expect(castRawManaCost(state, src.card!, src.zone)).toEqual({
                    X: 3,
                    R: 1,
                });
            });
        });

        it("a card without harmonize has no graveyard cast mechanism", () => {
            const state = board({ defId: lightningBolt().id, red: 4 });
            const p1 = getPlayer(state, "p1");
            expect(hasHarmonize(p1.graveyard[0])).toBe(false);
            expect(
                graveyardCastMechanism(state, p1, p1.graveyard[0], "p1")
            ).toBeUndefined();
        });
    });

    describe("the castability gate", () => {
        it("offers the cast when the full harmonize cost is affordable", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                expect(legal(board({ red: 4 }))).toContain("cast");
            });
        });

        it("offers it when only the reduction from an untapped creature makes it affordable", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 2,
                    battlefield: [creature(grizzlyBears().id, "bears")],
                });
                expect(legal(state)).toContain("cast");
            });
        });

        it("refuses it when no untapped creature buys enough reduction", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                expect(legal(board({ red: 2 }))).not.toContain("cast");
                const tapped = board({
                    red: 2,
                    battlefield: [
                        creature(grizzlyBears().id, "bears", {
                            isTapped: true,
                        }),
                    ],
                });
                expect(legal(tapped)).not.toContain("cast");
                const theirs = board({
                    red: 2,
                    opponentBattlefield: [
                        creature(grizzlyBears().id, "bears", {
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                });
                expect(legal(theirs)).not.toContain("cast");
            });
        });

        it("prices the largest power among untapped creatures", () => {
            const state = board({
                defId: lightningBolt().id,
                battlefield: [
                    creature(grizzlyBears().id, "bears"),
                    creature(crawWurm().id, "wurm"),
                    creature(hillGiant().id, "giant", { isTapped: true }),
                ],
            });
            expect(
                largestHarmonizeReduction(state, getPlayer(state, "p1"))
            ).toBe(6);
        });

        it("a negative power reduces nothing", () => {
            const state = board({
                defId: lightningBolt().id,
                battlefield: [
                    creature(grizzlyBears().id, "bears", { power: -1 }),
                ],
            });
            const bears = getPlayer(state, "p1").battlefield[0];
            expect(harmonizeReductionFor(state, bears)).toBe(0);
        });
    });

    describe("the reduction and the tap (CR 702.180a/b, 601.2f)", () => {
        it("a targeted cast takes the tapped creature's power off the generic part and taps it", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 2,
                    battlefield: [creature(grizzlyBears().id, "bears")],
                });
                castAtOpponent(state, "bears");
                expect(state.pendingCast).toBeUndefined();
                const p1 = getPlayer(state, "p1");
                expect(state.stack.map((s) => s.id)).toEqual(["hz"]);
                expect(p1.manaPool.R).toBe(0);
                expect(p1.battlefield[0].isTapped).toBe(true);
            });
        });

        it("the reduction never pays a coloured pip", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 1,
                    battlefield: [creature(crawWurm().id, "wurm")],
                });
                castAtOpponent(state, "wurm");
                expect(state.stack.map((s) => s.id)).toEqual(["hz"]);
                expect(getPlayer(state, "p1").manaPool.R).toBe(0);
            });
        });

        it("without a creature the full cost is owed and nothing taps", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 2,
                    battlefield: [creature(grizzlyBears().id, "bears")],
                });
                castAtOpponent(state);
                expect(state.stack).toHaveLength(0);
                expect(state.pendingCast?.manaCost).toEqual({ X: 3, R: 1 });
                expect(getPlayer(state, "p1").battlefield[0].isTapped).toBe(
                    false
                );
            });
        });

        it("an untargeted cast through announceCast reduces, taps, and stamps the exile", async () => {
            await withTemporaryDefinitionAsync(HZ_SORCERY, async () => {
                const state = await announce(
                    board({
                        defId: HZ_SORCERY.id,
                        white: 2,
                        battlefield: [creature(hillGiant().id, "giant")],
                    }),
                    "giant"
                );
                expect(state.stack.map((s) => s.id)).toEqual(["hz"]);
                expect(state.stack[0].exileAnyTimeLeavesStack).toBe(true);
                const p1 = getPlayer(state, "p1");
                expect(p1.manaPool.W).toBe(0);
                expect(p1.battlefield[0].isTapped).toBe(true);
            });
        });

        it("a summoning-sick creature may be tapped: the tap is not a {T} cost (CR 302.6)", async () => {
            await withTemporaryDefinitionAsync(HZ_SORCERY, async () => {
                const base = board({
                    defId: HZ_SORCERY.id,
                    white: 2,
                    battlefield: [creature(hillGiant().id, "giant")],
                });
                getPlayer(base, "p1").battlefield[0].enteredOnTurn = base.turn;
                const state = await announce(base, "giant");
                expect(state.stack.map((s) => s.id)).toEqual(["hz"]);
            });
        });

        it("a parked cast whose creature was tapped meanwhile is stale (CR 601.2h)", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 1,
                    battlefield: [creature(grizzlyBears().id, "bears")],
                });
                castAtOpponent(state, "bears");
                expect(state.pendingCast?.harmonizeTapCreatureId).toBe("bears");
                expect(state.pendingCast?.manaCost).toEqual({ X: 1, R: 1 });
                const p1 = getPlayer(state, "p1");
                p1.battlefield[0].isTapped = true;
                p1.manaPool.R = 2;
                expect(tryAutoCommitPendingCast(state, "p1")).toBeNull();
                expect(state.stack).toHaveLength(0);
            });
        });
    });

    describe("announceCast refuses an illegal harmonize creature", () => {
        it("on a cast that is not a harmonize cast", async () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(wrathOfGod().id, {
                                id: "hz",
                                zone: "hand",
                            }),
                        ],
                        battlefield: [creature(grizzlyBears().id, "bears")],
                        manaPool: { W: 4, U: 0, B: 0, R: 0, G: 0, C: 0 },
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: "p1",
            });
            await expect(announce(state, "bears")).rejects.toThrow(
                /harmonize/i
            );
        });

        it("a tapped creature, or one the caster does not control", async () => {
            await withTemporaryDefinitionAsync(HZ_SORCERY, async () => {
                const tapped = board({
                    defId: HZ_SORCERY.id,
                    white: 5,
                    battlefield: [
                        creature(hillGiant().id, "giant", { isTapped: true }),
                    ],
                });
                await expect(announce(tapped, "giant")).rejects.toThrow(
                    /untapped/
                );
                const theirs = board({
                    defId: HZ_SORCERY.id,
                    white: 5,
                    opponentBattlefield: [
                        creature(hillGiant().id, "giant", {
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                });
                await expect(announce(theirs, "giant")).rejects.toThrow(
                    /creature you control/
                );
            });
        });
    });

    describe('exile "any time it would leave the stack"', () => {
        it("resolving: the spell does its work, then is exiled", () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({
                    red: 2,
                    battlefield: [creature(grizzlyBears().id, "bears")],
                });
                castAtOpponent(state, "bears");
                resolveTopOfStack(state);
                const p1 = getPlayer(state, "p1");
                expect(getPlayer(state, "p2").life).toBe(17);
                expect(p1.exile.map((c) => c.id)).toEqual(["hz"]);
                expect(p1.graveyard.some((c) => c.id === "hz")).toBe(false);
            });
        });
    });

    describe("the wire projection", () => {
        it('tags the viewer\'s own harmonize card castKind "harmonize" with its legal actions', () => {
            withTemporaryDefinition(HZ_INSTANT, () => {
                const state = board({ red: 4 });
                const projected = projectPublicState(state, 1, "p1");
                const card = projected.players[0].graveyard.find(
                    (c) => c.id === "hz"
                ) as { castKind?: string; legalActions?: string[] };
                expect(card.castKind).toBe("harmonize");
                expect(card.legalActions).toContain("cast");
            });
        });
    });
});
