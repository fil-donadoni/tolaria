// Characterisation of every server path that puts a Cast on the Stack or
// charges a cost, driven through the REGISTERED mutations (issue #4475, PRD
// #4474 T1). These are the safety net the Cast Commit kernel (issue #4445) and
// the search cast kernel (issue #4444) stand on: each test asserts only the
// OBSERVABLE outcome — the stack item and its cost record, lands tapped, life,
// grants and counters, cards moved, the mana pool — and never names a private
// function or the order calls are made in, so a kernel that folds these paths
// leaves them green and a kernel that drops a cost leg turns them red.
//
// Harness: `gameMutationHarness.ts` — a stub `MutationCtx` driving each
// mutation's own `_handler` (this project has no convex-test package).
//
// Paths, one describe each:
//   1. resolution-time cast — `castDuringResolution` answered through
//      `submitResolutionChoice` (CR 608.2g / 601.2), Chandra's +1;
//   2. alternative cost, immediate commit — `announceCast` (CR 118.9), Gush;
//   3. kicker, immediate commit — `announceCast` (CR 702.33), Kavu Titan;
//   4. delve, immediate commit (forced pick) — `announceCast` (CR 702.66),
//      Treasure Cruise;
//   5. retrace, immediate commit (forced discard) — `announceCast`
//      (CR 702.81a), Wrath of God under the Wrenn and Six emblem;
//   6. companion summon — `summonCompanion` (CR 702.139a / 116.2g);
//   7. morph turn-face-up — `turnPermanentFaceUp` (CR 702.37e / 116.2b);
//   8. pay-to-block tax — `confirmBlockers` (CR 509.1b), Hipparion, whose
//      card tests (`ice/__tests__/white.test.ts`) now call this seam too.

import { describe, expect, it } from "vitest";
import {
    announceCast,
    activateAbility,
    confirmBlockers,
    passPriority,
    submitResolutionChoice,
    summonCompanion,
    turnPermanentFaceUp,
} from "../game";
import { getCardByName, getDefinition } from "../cards";
import { WRENN_AND_SIX_EMBLEM_ID } from "../cards/emblems";
import { turnFaceDown } from "../gre/faceDown";
import { NO_BOARD_LAYER_VIEW } from "../gre/layers";
import { getPlayer, type GameState } from "../gre/state";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness";

const GAME = "game-1" as Id<"games">;
const idOf = (name: string) => getCardByName(name).id;
const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

const run = (
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
) => runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, args);

const lands = (name: string, owner: string, n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(idOf(name), {
            id: `${prefix}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "battlefield",
        })
    );

// ---------------------------------------------------------------------------
// 1. Resolution-time cast (CR 608.2g — "you may cast that card" while the
//    ability resolves; the spell is cast following CR 601.2 and pays its real
//    mana cost). Two seats under ONE user (the solo shape, `${userId}-p1`), so
//    one stub drives both players' mutations against one document store.
// ---------------------------------------------------------------------------

describe("resolution-time cast — Chandra, Torch of Defiance's +1 cast through submitResolutionChoice (CR 608.2g / 601.2, issue #4475)", () => {
    const ME = "u-p1";
    const OPP = "u-p2";

    function chandraBoard(): GameState {
        const chandra = makeInstance(idOf("Chandra, Torch of Defiance"), {
            id: "chandra",
            controllerId: ME,
            ownerId: ME,
            zone: "battlefield",
            counters: { loyalty: 4 },
        });
        const bears = makeInstance(idOf("Grizzly Bears"), {
            id: "top-card",
            controllerId: ME,
            ownerId: ME,
            zone: "library",
        });
        return makeState({
            players: [
                makePlayer(ME, {
                    battlefield: [chandra, ...lands("Forest", ME, 2, "forest")],
                    library: [bears],
                }),
                makePlayer(OPP),
            ],
            activePlayerId: ME,
            priorityPlayerId: ME,
        });
    }

    async function resolveChandraPlusOne(harness: MutationStub) {
        await run(harness, activateAbility, {
            gameId: GAME,
            playerId: ME,
            cardInstanceId: "chandra",
            abilityId: "chandra-torch-of-defiance-plus1-impulse",
        });
        // CR 117.4 — both players pass in succession; the ability resolves.
        await run(harness, passPriority, { gameId: GAME, playerId: ME });
        await run(harness, passPriority, { gameId: GAME, playerId: OPP });
        const parked = harness.state();
        const choice = parked.pendingChoices?.[0];
        expect(choice?.playerId).toBe(ME);
        return { parked, choice: choice! };
    }

    it("casting the exiled card pays its mana cost: the spell is on the stack, both Forests are tapped, and the reflexive damage never fires", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(chandraBoard())]);
        const { choice } = await resolveChandraPlusOne(harness);

        await run(harness, submitResolutionChoice, {
            gameId: GAME,
            playerId: ME,
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["cast"],
        });

        const after = harness.state();
        const me = getPlayer(after, ME);
        // CR 601.2i — the cast card is a spell on the stack, out of exile.
        expect(after.stack.map((s) => s.id)).toEqual(["top-card"]);
        expect(after.stack[0].controllerId).toBe(ME);
        expect(me.exile).toHaveLength(0);
        expect(me.library).toHaveLength(0);
        // CR 601.2g-h — {1}{G} was paid: both Forests tapped, nothing floats.
        expect(
            me.battlefield
                .filter((c) => c.id.startsWith("forest"))
                .every((c) => c.isTapped)
        ).toBe(true);
        expect(me.manaPool).toMatchObject(EMPTY_POOL);
        // CR 606.4 — the +1 was paid as the ability was activated.
        expect(
            me.battlefield.find((c) => c.id === "chandra")?.counters?.loyalty
        ).toBe(5);
        // "If you don't [cast it]" — cast, so no 2 damage.
        expect(getPlayer(after, OPP).life).toBe(20);
        expect(after.pendingChoices ?? []).toHaveLength(0);
    });

    it("declining leaves the card exiled, taps nothing, and Chandra deals 2 to the opponent", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(chandraBoard())]);
        const { choice } = await resolveChandraPlusOne(harness);

        await run(harness, submitResolutionChoice, {
            gameId: GAME,
            playerId: ME,
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["decline"],
        });

        const after = harness.state();
        const me = getPlayer(after, ME);
        expect(after.stack).toHaveLength(0);
        expect(me.exile.map((c) => c.id)).toEqual(["top-card"]);
        expect(me.battlefield.some((c) => c.isTapped)).toBe(false);
        expect(getPlayer(after, OPP).life).toBe(18);
    });
});

// ---------------------------------------------------------------------------
// 2–5. `announceCast`'s IMMEDIATE commit: the whole cast — announcement, every
//      cost leg, the stack push — in ONE mutation, because the pool already
//      covers the mana and every non-mana pick is forced.
// ---------------------------------------------------------------------------

describe("announceCast immediate commit — alternative cost (CR 118.9, issue #4475)", () => {
    it("Gush for its alternative cost: both Islands return to hand, no mana is spent, and the spell is on the stack", async () => {
        const gush = makeInstance(idOf("Gush"), {
            id: "gush",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const islands = lands("Island", "p1", 2, "island").map((c) => ({
            ...c,
            isTapped: true,
        }));
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [gush],
                            battlefield: islands,
                            manaPool: { ...EMPTY_POOL, U: 1 },
                        }),
                        makePlayer("p2"),
                    ],
                })
            ),
        ]);

        await run(harness, announceCast, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "gush",
            alternativeCostId: "return-two-islands",
        });

        const after = harness.state();
        const p1 = getPlayer(after, "p1");
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["gush"]);
        expect(after.stack[0].castById).toBe("p1");
        // CR 118.9 — the alt cost replaced the mana cost entirely: the {U}
        // floating is untouched, and the cost's own leg was paid.
        expect(p1.manaPool.U).toBe(1);
        expect(p1.battlefield).toHaveLength(0);
        expect(p1.hand.map((c) => c.id).sort()).toEqual([
            "island-0",
            "island-1",
        ]);
    });
});

describe("announceCast immediate commit — kicker (CR 702.33a / 601.2f, issue #4475)", () => {
    function kavuBoard(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(idOf("Kavu Titan"), {
                            id: "kavu",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    manaPool: { ...EMPTY_POOL, G: 5 },
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("a kicked Kavu Titan pays {1}{G} + {2}{G} out of the pool and carries the kicker record onto the stack", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(kavuBoard())]);
        await run(harness, announceCast, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "kavu",
            kickerPayments: { kicker: 1 },
        });

        const after = harness.state();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["kavu"]);
        expect(after.stack[0].kickerPayments).toEqual({ kicker: 1 });
        // CR 601.2f — total cost {3}{G}{G}: all five green spent.
        expect(getPlayer(after, "p1").manaPool.G).toBe(0);
    });

    it("the unkicked cast pays {1}{G} alone and records no kicker", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(kavuBoard())]);
        await run(harness, announceCast, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "kavu",
        });

        const after = harness.state();
        expect(after.stack.map((s) => s.id)).toEqual(["kavu"]);
        expect(after.stack[0].kickerPayments).toBeUndefined();
        expect(getPlayer(after, "p1").manaPool.G).toBe(3);
    });
});

describe("announceCast immediate commit — delve, forced pick (CR 702.66a / 601.2f, issue #4475)", () => {
    it("Treasure Cruise with exactly seven graveyard cards and {U} floating: all seven are exiled, the {U} is spent, and the spell is on the stack in one mutation", async () => {
        const cruise = makeInstance(idOf("Treasure Cruise"), {
            id: "cruise",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const graveyard = Array.from({ length: 7 }, (_, i) =>
            makeInstance(idOf("Island"), {
                id: `gy-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [cruise],
                            graveyard,
                            manaPool: { ...EMPTY_POOL, U: 1 },
                        }),
                        makePlayer("p2"),
                    ],
                })
            ),
        ]);

        await run(harness, announceCast, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "cruise",
        });

        const after = harness.state();
        const p1 = getPlayer(after, "p1");
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["cruise"]);
        // CR 702.66a — each exiled card paid for {1} of the {7}.
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.map((c) => c.id).sort()).toEqual(
            graveyard.map((c) => c.id).sort()
        );
        expect(p1.manaPool.U).toBe(0);
    });
});

describe("announceCast immediate commit — retrace, forced discard (CR 702.81a, issue #4475)", () => {
    it("Wrath of God from the graveyard under the Wrenn and Six emblem with ONE land in hand: the land is discarded, {2}{W}{W} is spent, and the spell is on the stack in one mutation", async () => {
        const wrath = makeInstance(idOf("Wrath of God"), {
            id: "wrath",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const land = makeInstance(idOf("Plains"), {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                makeState({
                    players: [
                        makePlayer("p1", {
                            graveyard: [wrath],
                            hand: [land],
                            manaPool: { ...EMPTY_POOL, W: 4 },
                        }),
                        makePlayer("p2"),
                    ],
                    emblems: [
                        {
                            id: "emblem-p1",
                            ownerId: "p1",
                            emblemId: WRENN_AND_SIX_EMBLEM_ID,
                            name: "Wrenn and Six emblem",
                        },
                    ],
                })
            ),
        ]);

        await run(harness, announceCast, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "wrath",
        });

        const after = harness.state();
        const p1 = getPlayer(after, "p1");
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack.map((s) => s.id)).toEqual(["wrath"]);
        // CR 702.81a — the land was DISCARDED (graveyard, not exile).
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.map((c) => c.id)).toEqual(["land"]);
        expect(p1.manaPool.W).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 6–7. The two special actions that charge a cost without a stack item.
// ---------------------------------------------------------------------------

describe("summonCompanion — the {3} companion special action (CR 702.139a / 116.2g, issue #4475)", () => {
    function companionBoard(mountains: number): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: lands("Mountain", "p1", mountains, "mtn"),
                    companion: {
                        instance: makeInstance(idOf("Lutri, the Spellchaser"), {
                            id: "lutri",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "sideboard" as never,
                        }),
                        used: false,
                    },
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("taps three lands for {3}, puts the companion into hand, marks the slot used, and adds no stack item", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(companionBoard(4)),
        ]);
        await run(harness, summonCompanion, { gameId: GAME, playerId: "p1" });

        const after = harness.state();
        const p1 = getPlayer(after, "p1");
        expect(p1.hand.map((c) => c.id)).toEqual(["lutri"]);
        expect(p1.companion?.used).toBe(true);
        expect(after.stack).toHaveLength(0);
        expect(p1.battlefield.filter((c) => c.isTapped)).toHaveLength(3);
        expect(p1.manaPool).toMatchObject(EMPTY_POOL);
    });

    it("is refused with only two lands, and nothing is written", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(companionBoard(2)),
        ]);
        await expect(
            run(harness, summonCompanion, { gameId: GAME, playerId: "p1" })
        ).rejects.toThrow();
        expect(harness.writes).toHaveLength(0);
    });
});

describe("turnPermanentFaceUp — the morph special action (CR 702.37e / 116.2b, issue #4475)", () => {
    function faceDownBoard(plains: number): GameState {
        const angel = makeInstance(idOf("Exalted Angel"), {
            id: "morphed",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, angel, "morph");
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        angel,
                        ...lands("Plains", "p1", plains, "plains"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("pays {2}{W}{W} by tapping four Plains and turns the Angel face up", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(faceDownBoard(4)),
        ]);
        await run(harness, turnPermanentFaceUp, {
            gameId: GAME,
            playerId: "p1",
            cardInstanceId: "morphed",
        });

        const after = harness.state();
        const p1 = getPlayer(after, "p1");
        const angel = p1.battlefield.find((c) => c.id === "morphed")!;
        expect(angel.faceDown).toBeUndefined();
        expect((angel.card as { id: string }).id).toBe(idOf("Exalted Angel"));
        expect(
            p1.battlefield.filter(
                (c) => c.id.startsWith("plains") && c.isTapped
            )
        ).toHaveLength(4);
        expect(p1.manaPool).toMatchObject(EMPTY_POOL);
        expect(after.stack).toHaveLength(0);
    });

    it("is refused with three Plains, and nothing is written", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(faceDownBoard(3)),
        ]);
        await expect(
            run(harness, turnPermanentFaceUp, {
                gameId: GAME,
                playerId: "p1",
                cardInstanceId: "morphed",
            })
        ).rejects.toThrow();
        expect(harness.writes).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// 8. The pay-to-block tax charged from `confirmBlockers` (CR 509.1b).
// ---------------------------------------------------------------------------

describe("confirmBlockers — the pay-to-block tax (CR 509.1b, issue #4475)", () => {
    const hipparion = getDefinition("5969875a-f647-4daf-b76c-d1514d45c312");

    function hipparionBlocks(attackerPower: number, plains: number) {
        const attacker = makeInstance(idOf("Grizzly Bears"), {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isAttacking: true,
            counters:
                attackerPower > 2 ? { "+1/+1": attackerPower - 2 } : undefined,
        });
        return makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(hipparion.id, {
                            id: "hipp",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "battlefield",
                        }),
                        ...lands("Plains", "p2", plains, "p2-plains"),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { hipp: ["atk"] },
                blockersConfirmed: false,
            },
        });
    }

    it("blocking a power-4 attacker taps a Plains for the {1} and confirms the block", async () => {
        const harness = makeMutationCtx("p2", [
            gameStateSeed(hipparionBlocks(4, 1)),
        ]);
        await run(harness, confirmBlockers, { gameId: GAME, playerId: "p2" });

        const after = harness.state();
        const p2 = getPlayer(after, "p2");
        expect(after.combat?.blockersConfirmed).toBe(true);
        expect(
            p2.battlefield.find((c) => c.id === "p2-plains-0")?.isTapped
        ).toBe(true);
        expect(p2.manaPool).toMatchObject(EMPTY_POOL);
    });

    it("blocking a power-2 attacker is free: nothing taps", async () => {
        const harness = makeMutationCtx("p2", [
            gameStateSeed(hipparionBlocks(2, 1)),
        ]);
        await run(harness, confirmBlockers, { gameId: GAME, playerId: "p2" });

        const after = harness.state();
        expect(after.combat?.blockersConfirmed).toBe(true);
        expect(getPlayer(after, "p2").battlefield.some((c) => c.isTapped)).toBe(
            false
        );
    });

    it("an unpayable tax rejects the declaration and nothing is written", async () => {
        const harness = makeMutationCtx("p2", [
            gameStateSeed(hipparionBlocks(4, 0)),
        ]);
        await expect(
            run(harness, confirmBlockers, { gameId: GAME, playerId: "p2" })
        ).rejects.toThrow(/pay \{1\}/i);
        expect(harness.writes).toHaveLength(0);
    });
});
