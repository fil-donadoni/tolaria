// Bot enumeration of a cast whose SECOND target group is announced only if
// the spell was kicked (CR 702.33g / CR 601.2c, issue #4220).
//
// The Bot enumerates one cast variant per kicker decision (issue #2081), and
// each variant's target groups must be the groups `announceCast` will actually
// open for THAT variant. Both directions fail, and both fail silently:
//
//  - a gated group enumerated on an UNKICKED variant makes the executor's
//    `selectTargets` carry a pick for a group the mutation never opened;
//  - a gated group omitted from a KICKED variant leaves the announcement
//    half-filled, and the executor's very next `tapForPayment` throws on
//    `assertExpectedInput(expect: "priority")` — the Bot stalling on a move it
//    generated itself, the exact shape
//    `moves-additional-target-groups.bot.test.ts` pins for Hull Breach.
//
// Two legs for that reason: ENUMERATION (the variant carries the right group
// count) and EXECUTION (that exact move replays through the real registered
// mutations in the executor's own order).
//
// No catalogue card carries the shape yet — Orim's Thunder is blocked on the
// grammar half of its own text, filed separately — so the board registers a
// variant through the `withTemporaryDefinition` seam.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { ankhOfMishra, plains } from "../../cards/sets/lea/colorless";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { announceCast, selectTargets, tapForPayment } from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import type { GameState } from "../state";

/** Orim's Thunder's announcement — base group an artifact-or-enchantment, the
 *  KICKED half a creature — with the card's own out-of-scope back-reference
 *  ("damage equal to that permanent's mana value") replaced by a fixed 2. The
 *  kicker is one generic so a single untapped Plains funds it. */
const THUNDER: CardDefinition = {
    id: "5f86bba5-e203-4a86-a415-ce748f6d1f6f",
    name: "Kicked Thunder",
    rarity: "uncommon",
    oracleText:
        "Kicker {1}\nDestroy target artifact or enchantment. If this spell was kicked, it deals 2 damage to target creature.",
    manaCost: {},
    types: ["Instant"],
    kickers: [{ id: "kicker", description: "Kicker {1}", mana: { X: 1 } }],
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    additionalTargetRequirements: [
        { type: "Creature", count: 1, announcedOnlyIfKicked: true },
    ],
    effects: [
        { op: "destroy", target: { target: 0 } },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "dealDamage", amount: 2, to: { target: 1 } }],
        },
    ],
};

type CastMove = Extract<Move, { kind: "cast-spell" }>;

/** p1 holds the spell with one untapped Plains (the kicker's only generic);
 *  p2 has the artifact the base group destroys and the 2/2 the kicked group
 *  burns. */
function board(): GameState {
    const spell = makeInstance(THUNDER.id, {
        id: "thunder-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const land = makeInstance(plains.id, {
        id: "plains-0",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const art = makeInstance(ankhOfMishra.id, {
        id: "ankh",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    const victim = makeInstance(grizzlyBears.id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { hand: [spell], battlefield: [land] }),
            makePlayer("p2", { battlefield: [art, victim] }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function castMoves(state: GameState): CastMove[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === "thunder-1"
    );
}

/** Did this variant pay a Kicker? (CR 702.33d — the tally, not the record.) */
function kicked(m: CastMove): boolean {
    return Object.values(m.kickerPayments ?? {}).some((n) => n > 0);
}

describe("bot enumeration — a target group announced only if kicked (CR 702.33g, issue #4220)", () => {
    it("enumerates the gated group in EXACTLY the variants that pay the kicker", () => {
        withTemporaryDefinition(THUNDER, () => {
            const moves = castMoves(board());
            const kickedMoves = moves.filter(kicked);
            const plainMoves = moves.filter((m) => !kicked(m));
            expect(kickedMoves.length).toBeGreaterThan(0);
            expect(plainMoves.length).toBeGreaterThan(0);
            for (const m of plainMoves) {
                // CR 702.33g — "the spell is cast as if it did not have those
                // targets".
                expect(m.targets.map((t) => t.id)).toEqual(["ankh"]);
            }
            for (const m of kickedMoves) {
                // Base group first, gated group second — the flat declaration
                // order the Effect Script reads positionally.
                expect(m.targets.map((t) => t.id)).toEqual(["ankh", "bears"]);
            }
        });
    });

    it("still enumerates the KICKED variant when no creature is on the board", () => {
        // The gated group's candidate set is empty, which must not suppress
        // the kicked cast's BASE group — the kicker is optional and the
        // castability gate reads the primary requirement only.
        withTemporaryDefinition(THUNDER, () => {
            const state = board();
            state.players[1]!.battlefield =
                state.players[1]!.battlefield.filter((c) => c.id !== "bears");
            const moves = castMoves(state);
            expect(moves.length).toBeGreaterThan(0);
            for (const m of moves) {
                expect(m.targets.map((t) => t.id)).toEqual(["ankh"]);
            }
        });
    });
});

describe("bot execution — the kicked variant replays through the real mutations (issue #4220)", () => {
    it("announces, fills BOTH groups and pays, without stranding the gated group", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const state = board();
            const move = castMoves(state).find(kicked)!;
            expect(move).toBeDefined();
            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            const base = { gameId: "game-1" as Id<"games">, playerId: "p1" };

            // 1. announceCast — what `executeMove`'s "cast-spell" branch does.
            await runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...base,
                    cardInstanceId: move.cardInstanceId,
                    ...(move.kickerPayments
                        ? { kickerPayments: move.kickerPayments }
                        : {}),
                }
            );

            // 2. selectTargets — ONE batched call carrying every group's pick.
            await runMutation(
                selectTargets as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
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
            // Every group is answered: the next mutation the executor fires is
            // legal.
            expect(harness.state().pendingTarget).toBeUndefined();

            // 3. tapForPayment — the call that throws when a group is still
            // open.
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

            const item = harness
                .state()
                .stack.find((s) => s.card.id === THUNDER.id)!;
            expect(item).toBeDefined();
            expect((item.targets ?? []).map((t) => t.id)).toEqual([
                "ankh",
                "bears",
            ]);
        });
    });

    it("the UNKICKED variant replays with the base group alone", async () => {
        await withTemporaryDefinitionAsync(THUNDER, async () => {
            const state = board();
            const move = castMoves(state).find((m) => !kicked(m))!;
            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            const base = { gameId: "game-1" as Id<"games">, playerId: "p1" };
            await runMutation(
                announceCast as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                { ...base, cardInstanceId: move.cardInstanceId }
            );
            await runMutation(
                selectTargets as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    ...base,
                    targets: move.targets.map((t) => ({
                        targetType: t.type,
                        targetId: t.id,
                    })),
                }
            );
            expect(harness.state().pendingTarget).toBeUndefined();
            const item = harness
                .state()
                .stack.find((s) => s.card.id === THUNDER.id)!;
            expect((item.targets ?? []).map((t) => t.id)).toEqual(["ankh"]);
        });
    });
});
