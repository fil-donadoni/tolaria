// Integration: a MULTI-MODE announcement (ADR 0094, issue #2265) crosses the
// enumerator → executor → registered `game.ts` mutations boundary without a
// stall, and the spell the server puts on the stack is the one the search
// valued — same mode instances, same per-instance target spans.
//
// Why the whole path and not the enumerator alone: an enumerated Move that
// `announceCast` rejects, or whose batched `selectTargets` lands a pick on the
// wrong group, is exactly as frozen as no Move at all (the #2283/#2284 class),
// and neither half can see that alone. Harness discipline as the other
// `game.ts` integration coverage: the REGISTERED mutations' own `_handler`s
// (`gameMutationHarness.ts`), never a reimplementation.
//
// Fixture: Darigaaz's Charm with a `modeSelection` (no shipped card declares
// one before issue #2266) — a fixture for "targeted scripted modes", never
// read by name in the code under test.

import { describe, expect, it } from "vitest";
import {
    announceCast,
    activateAbility,
    confirmTargets,
    selectTargets,
    tapForPayment,
} from "@convex/game";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinitionAsync } from "@convex/cards/registry";
import type { ModeSelection } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
    type MutationStub,
} from "@convex/__tests__/gameMutationHarness";
import { enumerateMoves, type Move } from "@convex/gre/moves";
import type { GameState } from "@convex/gre/state";
import { resolveTopOfStack } from "@convex/gre/state";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "../executor";

const GAME_ID = "game-1" as Id<"games">;
const BOT = "p1";
const HUMAN = "p2";
const CHARM = getCardByName("Darigaaz's Charm");
const BEARS = getCardByName("Grizzly Bears").id;

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function board(): GameState {
    const land = (name: string) =>
        makeInstance(getCardByName(name).id, {
            id: name.toLowerCase(),
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(CHARM.id, {
                        id: "charm",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    land("Swamp"),
                    land("Mountain"),
                    land("Forest"),
                    makeInstance(BEARS, {
                        id: "my-bears",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer(HUMAN, { life: 6 }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

function realMutations(harness: MutationStub): MoveMutations {
    const drive =
        <A>(fn: unknown) =>
        async (args: A) =>
            runMutation<A, void>(fn as Handler<A, void>, harness.ctx, args);
    const surface: Record<string, unknown> = {
        announceCast: drive(announceCast),
        selectTargets: drive(selectTargets),
        confirmTargets: drive(confirmTargets),
        tapForPayment: drive(tapForPayment),
        activateAbility: drive(activateAbility),
    };
    return new Proxy(surface, {
        get: (target, name: string) =>
            target[name] ??
            (async () => {
                throw new Error(`unexpected mutation ${name} in this flow`);
            }),
    }) as unknown as MoveMutations;
}

function castOf(state: GameState, pick: (m: CastMove) => boolean): CastMove {
    const matches = enumerateMoves(state, BOT).filter(
        (m): m is CastMove => m.kind === "cast-spell" && pick(m)
    );
    expect(matches).toHaveLength(1);
    return matches[0];
}

async function runCast(
    selection: ModeSelection,
    pick: (m: CastMove) => boolean
) {
    return withTemporaryDefinitionAsync(
        { ...CHARM, modeSelection: selection },
        async () => {
            const state = board();
            const move = castOf(state, pick);
            const harness = makeMutationCtx(BOT, [gameStateSeed(state)]);
            await executeMove(move, {
                gameId: GAME_ID,
                botId: BOT,
                mutations: realMutations(harness),
            });
            const after = harness.state();
            return { move, after };
        }
    );
}

describe("a multi-mode cast executes end to end (ADR 0094, issue #2265)", () => {
    it("two distinct instances: the stack item carries the move's modes, spans and targets", async () => {
        const { move, after } = await runCast(
            { min: 2, max: 2 },
            (m) =>
                m.chosenModeIds?.join("+") === "damage+pump" &&
                m.targets[0]?.id === HUMAN &&
                m.targets[1]?.id === "my-bears"
        );
        expect(after.pendingTarget).toBeUndefined();
        expect(after.pendingCast).toBeUndefined();
        expect(after.stack).toHaveLength(1);
        const item = after.stack[0];
        expect(item.chosenModeIds).toEqual(move.chosenModeIds);
        expect(item.modeTargetCounts).toEqual(move.modeTargetCounts);
        expect(item.targets?.map((t) => t.id)).toEqual([HUMAN, "my-bears"]);

        resolveTopOfStack(after);
        // The damage instance read its OWN first target (the player), not the
        // pump instance's creature.
        expect(after.players[1].life).toBe(3);
        expect(
            after.players[0].battlefield.some((c) => c.id === "my-bears")
        ).toBe(true);
    });

    it("a repeated mode aimed twice at the same player resolves both instances (CR 700.2d)", async () => {
        const { move, after } = await runCast(
            { min: 2, max: 2, repeats: true },
            (m) =>
                m.chosenModeIds?.join("+") === "damage+damage" &&
                m.targets.every((t) => t.id === HUMAN)
        );
        expect(move.modeTargetCounts).toEqual([1, 1]);
        expect(after.stack[0].modeTargetCounts).toEqual([1, 1]);
        resolveTopOfStack(after);
        expect(after.players[1].life).toBe(0);
    });
});
