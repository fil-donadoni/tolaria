// Bot enumeration of a cast with MULTIPLE independent target groups
// (CR 601.2c) — the primary `targetRequirement` plus every
// `additionalTargetRequirements` entry, card-level (Fumarole, Plague Spores) or
// mode-level (Hull Breach's third mode, issue #1953).
//
// The bug this file pins: `enumerateCastMoves` read ONLY the primary
// requirement, so a mode-3 Hull Breach was enumerated with ONE target. Executing
// it announced the cast, filled group 0, left the enchantment group pending, and
// the executor's very next `tapForPayment` threw on
// `assertExpectedInput(expect: "priority")` — the Bot stalling on a move it
// generated itself. In-search `applyMove` copies `move.targets` straight onto
// the stack item, so the same omission also made mode `both` evaluate
// identically to mode `artifact` in the tree.
//
// Two legs, because either alone would miss half the bug:
//  1. ENUMERATION — the emitted move carries one target per group, in
//     declaration order.
//  2. EXECUTION — that exact move, replayed through the REAL registered
//     mutations in the executor's own order (announceCast → selectTargets →
//     tapForPayment), reaches the stack instead of throwing.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { dralnusCrusade, hullBreach } from "../../cards/sets/pls/multicolor";
import { fumarole } from "../../cards/sets/ice/multicolor";
import { prismaticWard } from "../../cards/sets/ice/white";
import {
    blackLotus,
    forest,
    grizzlyBears,
    mountain,
    plains,
    swamp,
} from "../../cards/sets/lea";
import { announceCast, selectTargets, tapForPayment } from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import type { GameState } from "../state";

/** p1 holds Hull Breach with untapped R + G sources; p2 has one artifact and
 *  one enchantment, so mode `both` is the only mode with two live groups. */
function hullBreachBoard(): GameState {
    const breach = makeInstance(hullBreach.id, {
        id: "breach-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const lands = [mountain.id, forest.id].map((cardId, i) =>
        makeInstance(cardId, {
            id: `land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const art = makeInstance(blackLotus.id, {
        id: "art-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const ench = makeInstance(dralnusCrusade.id, {
        id: "ench-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { hand: [breach], battlefield: lands }),
            makePlayer("p2", { battlefield: [art, ench] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function castMoves(state: GameState, cardInstanceId: string): CastMove[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("bot enumeration — mode-level additional target groups (Hull Breach, CR 601.2c / issue #1953)", () => {
    it("enumerates mode `both` with ONE target per group, in declaration order", () => {
        const moves = castMoves(hullBreachBoard(), "breach-1");
        const both = moves.filter((m) => m.chosenModeId === "both");
        expect(both.length).toBeGreaterThan(0);
        for (const m of both) {
            // Group 0 = the artifact, group 1 = the enchantment: the flat order
            // the Effect Script reads positionally (`{ target: 0 }` / `{ target: 1 }`).
            expect(m.targets.map((t) => t.id)).toEqual(["art-1", "ench-1"]);
            // Every group is fixed-count, so nothing needs a trailing confirm.
            expect(m.confirmTargets).toBe(false);
        }
    });

    it("still enumerates the single-group modes with exactly one target", () => {
        const moves = castMoves(hullBreachBoard(), "breach-1");
        expect(
            moves
                .filter((m) => m.chosenModeId === "artifact")
                .map((m) => m.targets.map((t) => t.id))
        ).toEqual([["art-1"]]);
        expect(
            moves
                .filter((m) => m.chosenModeId === "enchantment")
                .map((m) => m.targets.map((t) => t.id))
        ).toEqual([["ench-1"]]);
    });

    it("makes mode `both` genuinely different from mode `artifact` in the search tree", () => {
        // `applyMoveInSearch` copies `move.targets` onto the stack item; with
        // the enchantment group dropped the two modes produced an IDENTICAL
        // stack item and evaluated the same.
        const stackTargets = (modeId: string): string[] => {
            const state = hullBreachBoard();
            const move = castMoves(state, "breach-1").find(
                (m) => m.chosenModeId === modeId
            )!;
            applyMoveInSearch(state, "p1", move);
            const item = state.stack.find((s) => s.id === "breach-1")!;
            return (item.targets ?? []).map((t) => t.id);
        };
        expect(stackTargets("artifact")).toEqual(["art-1"]);
        expect(stackTargets("both")).toEqual(["art-1", "ench-1"]);
    });

    it("drops mode `both` entirely when one of its groups has no legal candidate (CR 700.2d)", () => {
        const state = hullBreachBoard();
        // Remove the only enchantment — group 1 is now unfillable.
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "ench-1"
        );
        const moves = castMoves(state, "breach-1");
        expect(moves.some((m) => m.chosenModeId === "both")).toBe(false);
        expect(moves.some((m) => m.chosenModeId === "artifact")).toBe(true);
    });

    // The card-level twin of the same seam — Fumarole ("Destroy target creature
    // and target land") predates this PR and was enumerated with one target too.
    it("enumerates the CARD-level group list too (Fumarole)", () => {
        const fum = makeInstance(fumarole.id, {
            id: "fum-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // {3}{B}{R} — five sources, at least one black and one red.
        const lands = [
            mountain.id,
            mountain.id,
            swamp.id,
            swamp.id,
            swamp.id,
        ].map((cardId, i) =>
            makeInstance(cardId, {
                id: `fum-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const victim = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const theirLand = makeInstance(mountain.id, {
            id: "their-land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [fum], battlefield: lands }),
                makePlayer("p2", { battlefield: [victim, theirLand] }),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const moves = castMoves(state, "fum-1");
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            // One creature target then one land target — never a lone creature.
            expect(m.targets).toHaveLength(2);
            expect(m.targets[0].id).toBe("bears-1");
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// The other half of the same `??` chain: a modal card whose chosen MODE
// carries no `targetRequirement` while the CARD does. `announceCast` reads
// `chosenMode?.targetRequirement ?? kickerAdjustedTargetRequirement(cardDef,
// …)`, so it falls back to the card level; a ternary on `mode` here yielded
// `undefined` instead and the Bot emitted one ZERO-target cast per mode.
// Prismatic Ward is the reference shape — its five `modes` are the as-enters
// colour pick (CR 700.2c), the Aura's "enchant creature" target lives on the
// card. Same shape: Chromatic Armor, Magical Hack, Phantasmal Terrain,
// Sleight of Mind.

/** p1 holds Prismatic Ward with two untapped Plains; p2 has one creature. */
function prismaticWardBoard(): GameState {
    const ward = makeInstance(prismaticWard.id, {
        id: "ward-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    // {1}{W} — two Plains cover both the generic and the coloured pip.
    const lands = [0, 1].map((i) =>
        makeInstance(plains.id, {
            id: `plains-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const victim = makeInstance(grizzlyBears.id, {
        id: "bears-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { hand: [ward], battlefield: lands }),
            makePlayer("p2", { battlefield: [victim] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("bot enumeration — a mode with no requirement falls back to the CARD's (Prismatic Ward, issue #1953)", () => {
    it("carries the card-level creature target, never zero targets", () => {
        const moves = castMoves(prismaticWardBoard(), "ward-1");
        expect(moves.length).toBeGreaterThan(0);
        for (const m of moves) {
            expect(m.targets.map((t) => t.id)).toEqual(["bears-1"]);
        }
    });

    it("CR 614.12a (issue #2019) — announces NO mode: the colour is an as-enters pick", () => {
        // Prismatic Ward's five `modes` are its "As this Aura enters, choose a
        // color" clause, a CR 614.1c replacement, so the pick is answered at
        // the CR 614 entry chokepoint and `announceCast` REJECTS one sent at
        // announcement. Enumerating a Move per mode would generate five moves
        // the mutation throws on — a Bot stalling on its own move, the exact
        // failure shape this file exists for.
        const moves = castMoves(prismaticWardBoard(), "ward-1");
        expect(moves).toHaveLength(1);
        expect(moves[0].chosenModeId).toBeUndefined();
    });
});

describe("bot execution — the enumerated multi-group move is executable end to end (issue #1953)", () => {
    it("replays mode `both` through the real mutations without stranding a target group", async () => {
        const state = hullBreachBoard();
        const allModes = new Set(
            castMoves(state, "breach-1").map((m) => m.chosenModeId)
        );
        // CR 700.2c (the must-NOT row for issue #2019) — an ordinary modal
        // SPELL is still enumerated one Move per mode; only a card whose modes
        // ARE its as-enters clause stops announcing at cast time.
        expect(allModes.size).toBeGreaterThan(1);
        expect(allModes.has(undefined)).toBe(false);
        const move = castMoves(state, "breach-1").find(
            (m) => m.chosenModeId === "both"
        )!;
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        const base = {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
        };

        // 1. announceCast — exactly what `executeMove`'s "cast-spell" branch does.
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                ...base,
                cardInstanceId: move.cardInstanceId,
                chosenModeId: move.chosenModeId,
            }
        );

        // 2. selectTargets — ONE batched call carrying every group's picks.
        await runMutation(
            selectTargets as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                ...base,
                targets: move.targets.map((t) => ({
                    targetType: t.type,
                    targetId: t.id,
                    ...(t.playerId ? { targetPlayerId: t.playerId } : {}),
                })),
            }
        );
        // Every group is answered: nothing is left pending, so the next
        // mutation the executor fires is legal.
        expect(harness.state().pendingTarget).toBeUndefined();

        // 3. tapForPayment — the call that used to throw
        // "assertExpectedInput(expect: 'priority')" because the enchantment
        // group was still open.
        await expect(
            runMutation(
                tapForPayment as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...base,
                    payments: move.tapPlan.map((tap) => ({
                        cardInstanceId: tap.cardInstanceId,
                        ...(tap.manaChoiceIndex !== undefined
                            ? { manaChoiceIndex: tap.manaChoiceIndex }
                            : {}),
                    })),
                }
            )
        ).resolves.toBeUndefined();

        // The spell is on the stack carrying BOTH announced targets.
        const after = harness.state();
        const item = after.stack.find((s) => s.card.id === hullBreach.id)!;
        expect(item).toBeDefined();
        expect((item.targets ?? []).map((t) => t.id)).toEqual([
            "art-1",
            "ench-1",
        ]);
        expect(item.chosenModeId).toBe("both");
    });

    it("replays a mode-with-no-requirement cast (Prismatic Ward) through the real mutations", async () => {
        const state = prismaticWardBoard();
        const move = castMoves(state, "ward-1")[0];
        // CR 614.12a (issue #2019) — no mode is announced; the colour pick is
        // raised as the Aura ENTERS, on every entry path.
        expect(move.chosenModeId).toBeUndefined();
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        const base = {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
        };

        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                ...base,
                cardInstanceId: move.cardInstanceId,
                chosenModeId: move.chosenModeId,
            }
        );

        // `announceCast` opened the CARD-level creature group; the enumerated
        // move must already carry a pick for it. With the old ternary
        // `move.targets` was empty, this call sent nothing, and `tapForPayment`
        // below threw "the game is waiting for target input, not priority".
        expect(move.targets).toHaveLength(1);
        await runMutation(
            selectTargets as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                ...base,
                targets: move.targets.map((t) => ({
                    targetType: t.type,
                    targetId: t.id,
                    ...(t.playerId ? { targetPlayerId: t.playerId } : {}),
                })),
            }
        );
        expect(harness.state().pendingTarget).toBeUndefined();

        await expect(
            runMutation(
                tapForPayment as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...base,
                    payments: move.tapPlan.map((tap) => ({
                        cardInstanceId: tap.cardInstanceId,
                        ...(tap.manaChoiceIndex !== undefined
                            ? { manaChoiceIndex: tap.manaChoiceIndex }
                            : {}),
                    })),
                }
            )
        ).resolves.toBeUndefined();

        const after = harness.state();
        const item = after.stack.find((s) => s.card.id === prismaticWard.id)!;
        expect(item).toBeDefined();
        expect((item.targets ?? []).map((t) => t.id)).toEqual(["bears-1"]);
        expect(item.chosenModeId).toBeUndefined();
    });

    it("CR 614.12a — announceCast REJECTS a chosenModeId for an as-enters card (fail-closed)", async () => {
        // The discriminator is the card's own declaration, not "is it a
        // permanent": a stale client that still sends the announcement-time
        // pick is rejected rather than silently double-picking.
        const state = prismaticWardBoard();
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "ward-1",
                    chosenModeId: "W",
                }
            )
        ).rejects.toThrow(/as it enters/i);
    });

    it("CR 700.2c — an ordinary modal spell still REQUIRES a mode at announcement (the must-NOT row)", async () => {
        const state = hullBreachBoard();
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "breach-1",
                }
            )
        ).rejects.toThrow(/must choose a mode at announcement/i);
    });
});
