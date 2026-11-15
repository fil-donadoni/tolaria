// Bot REACHABILITY for a split half cast free under a board permission
// (CR 709.3 + CR 118.9a, ADR 0121).
//
// The enumerator used to skip the permission pass for a split card: its Moves
// would have carried a permission id naming no half, which `announceCast`
// refuses. Now the permission id carries the half, so the Bot enumerates ONE
// free Move per covered half — and, where only the permission licenses a half
// (CR 118.9b), drops that half's paid Move, which the mutation would refuse.
// Each enumerated Move is driven through the real mutation here: a Move the
// mutation refuses is the bot-freeze class, not a weak line.
//
// The permission is a temporary definition (no shipped one covers a shipped
// split half); its mana-value ceiling covers one half and not the other.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget } from "../../game";
import { standDeliver } from "../../cards/sets/inv/multicolor.cards";
import { lifeDeath } from "../../cards/sets/apc/multicolor.cards";
import { hillGiant } from "../../cards/sets/lea/red.cards";
import { forest } from "../../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards/registry";
import { splitHalfDefinitionId } from "../../cards/splitCard";
import type { CardDefinition, EffectCardFilter } from "../../cards/types";
import { composeCastPermissionAltCostId } from "../castPermissionAltCostId";
import { isCastPermissionAltCostId } from "../castPermissions";
import { enumerateMoves, type Move } from "../moves";
import { splitCastAltCostId } from "../splitCast";
import type { GameState } from "../state";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import { getDefinition } from "../../cards/index";

const aluren = () => getDefinition("268403bc-733d-446e-a7c1-abc957c42bc2");

const PERMISSION_ID = "probe-free-cheap-spell";

/** Aluren's id (the registry's cast-permission membership finds it), its
 *  permission swapped for a free-and-flash one over `filter`. */
const permissionSource = (filter: EffectCardFilter): CardDefinition => ({
    ...aluren(),
    staticEffects: [
        {
            kind: "cast-permission",
            id: PERMISSION_ID,
            grantee: "controller",
            filter,
            withoutPayingManaCost: true,
            asThoughFlash: true,
            oracleText:
                "You may cast spells with mana value 1 or less without paying their mana costs and as though they had flash.",
        },
    ],
});

/** p1 holds `splitId` beside the permission source and `forests` Forests; p2
 *  has a Hill Giant. `offWindow` hands p1 priority in p2's turn. */
function board(splitId: string, forests: number, offWindow = false): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(splitId, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(aluren().id, {
                        id: "source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...Array.from({ length: forests }, (_, i) =>
                        makeInstance(forest().id, {
                            id: `forest${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(hillGiant().id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: offWindow ? "p2" : "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const castIds = (moves: Move[]): string[] =>
    moves.flatMap((m) =>
        m.kind === "cast-spell" && m.cardInstanceId === "split"
            ? [m.alternativeCostId ?? "printed"]
            : []
    );

describe("the Bot enumerates a split half's free cast (CR 709.3 + 118.9a)", () => {
    const instantPermission = permissionSource({
        type: "Instant",
        manaValueAtMost: 1,
    });
    const freeStand = composeCastPermissionAltCostId(
        PERMISSION_ID,
        splitCastAltCostId(standDeliver(), "left")
    );

    it("offers the covered half free with no mana, and never a permission Move naming no half", () => {
        withTemporaryDefinition(instantPermission, () => {
            const ids = castIds(
                enumerateMoves(board(standDeliver().id, 0), "p1")
            );
            expect(ids).toContain(freeStand);
            // Deliver (mana value 3) is not covered, and with no land neither
            // paid half is castable.
            expect(ids.filter(isCastPermissionAltCostId)).toEqual([freeStand]);
            expect(ids).not.toContain("printed");
        });
    });

    it("the enumerated free Move is one the mutation accepts, and casts the half", () =>
        withTemporaryDefinitionAsync(instantPermission, async () => {
            const state = board(standDeliver().id, 0);
            const move = enumerateMoves(state, "p1").find(
                (m) =>
                    m.kind === "cast-spell" && m.alternativeCostId === freeStand
            );
            expect(move).toBeDefined();
            const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
            const gameId = "game-1" as Id<"games">;
            await runMutation(
                announceCast as unknown as Handler<object, void>,
                harness.ctx,
                {
                    gameId,
                    playerId: "p1",
                    cardInstanceId: "split",
                    alternativeCostId: freeStand,
                }
            );
            await runMutation(
                selectTarget as unknown as Handler<object, void>,
                harness.ctx,
                {
                    gameId,
                    playerId: "p1",
                    targetType: "permanent",
                    targetId: "giant",
                }
            );
            const stack = harness.state().stack;
            expect(stack).toHaveLength(1);
            expect((stack[0].card as { id?: string }).id).toBe(
                splitHalfDefinitionId(standDeliver().id, "left")
            );
        }));

    it("drops the PAID Move of a half only the permission licenses, and keeps its free one (CR 118.9b)", () => {
        // Life // Death: two sorceries, mana value 1 and 2. Off p1's sorcery
        // window only the permission licenses Life, and only free; a Forest
        // makes the paid Life affordable, so its absence is the suppression.
        withTemporaryDefinition(
            permissionSource({ type: "Sorcery", manaValueAtMost: 1 }),
            () => {
                const life = splitCastAltCostId(lifeDeath(), "left");
                const ids = castIds(
                    enumerateMoves(board(lifeDeath().id, 1, true), "p1")
                );
                expect(ids).toContain(
                    composeCastPermissionAltCostId(PERMISSION_ID, life)
                );
                expect(ids).not.toContain(life);
            }
        );
    });
});
