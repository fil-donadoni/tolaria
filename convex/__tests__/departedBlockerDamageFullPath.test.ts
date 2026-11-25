// Full path for CR 510.1c: the REGISTERED `game.ts` mutations kill one of two
// blockers with a Lightning Bolt in the declare blockers step, then open and
// confirm the combat damage assignment over the one that is left.
import { describe, expect, it } from "vitest";
import {
    announceCast,
    confirmDamage,
    passPriority,
    selectTargets,
    setDamageAssignment,
} from "../game";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import {
    getPlayer,
    isDepartedCombatantId,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";

const card = (
    name: string,
    id: string,
    owner: string,
    zone: "hand" | "battlefield" | "library",
    overrides: Partial<CardInstanceState> = {}
) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
        isSummoningSick: false,
        ...overrides,
    });

/** My Earth Elemental (4/5, no trample) double-blocked; I hold priority in the
 *  declare blockers step with a Lightning Bolt and {R}. */
function board(): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        players: [
            makePlayer(ME, {
                hand: [card("Lightning Bolt", "bolt", ME, "hand")],
                battlefield: [
                    card("Earth Elemental", "atk", ME, "battlefield", {
                        isAttacking: true,
                        isTapped: true,
                    }),
                ],
                library: [card("Mountain", "my-lib", ME, "library")],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer(OPP, {
                battlefield: [
                    card("Grizzly Bears", "bears", OPP, "battlefield", {
                        isBlocking: true,
                    }),
                    card("Hill Giant", "giant", OPP, "battlefield", {
                        isBlocking: true,
                    }),
                ],
                library: [card("Forest", "opp-lib", OPP, "library")],
            }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { bears: ["atk"], giant: ["atk"] },
            blockersConfirmed: true,
            blockedAttackerIds: ["atk"],
        },
    });
}

async function call(
    harness: MutationStub,
    fn: unknown,
    args: Record<string, unknown>
): Promise<void> {
    await runMutation<Record<string, unknown>, unknown>(fn, harness.ctx, {
        gameId: GAME,
        ...args,
    });
}

/** Bolt the Bears, then pass until the damage assignment opens. */
async function openDamageAfterRemoval(): Promise<MutationStub> {
    const harness = makeMutationCtx("u", [gameStateSeed(board())]);
    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "bolt",
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "permanent", targetId: "bears" }],
    });
    for (let guard = 0; guard < 12; guard++) {
        const live = harness.state();
        if (live.combat?.damageConfirmed === false) break;
        await call(harness, passPriority, { playerId: live.priorityPlayerId });
    }
    const state = harness.state();
    expect(state.phase).toBe("COMBAT_DAMAGE");
    expect(state.combat!.damageConfirmed).toBe(false);
    expect(getPlayer(state, OPP).battlefield.map((c) => c.id)).toEqual([
        "giant",
    ]);
    return harness;
}

const tombstoneOf = (state: GameState): string =>
    Object.keys(state.combat!.blockerAssignments).find(isDepartedCombatantId)!;

describe("combat damage after one of two blockers left, through the mutations (CR 510.1c)", () => {
    it("confirms the default: full power on the blocker that is left", async () => {
        const harness = await openDamageAfterRemoval();
        expect(harness.state().combat!.damageAssignments).toEqual({
            atk: { giant: 4 },
        });

        await call(harness, confirmDamage, { playerId: ME });

        const state = harness.state();
        // Lethal on the 3/3 is 3; the rest of the 4 has nowhere else to go.
        expect(getPlayer(state, OPP).graveyard.map((c) => c.id)).toContain(
            "giant"
        );
        expect(getPlayer(state, OPP).life).toBe(20);
    });

    it("setDamageAssignment rejects the departed blocker's tombstone, at any amount", async () => {
        const harness = await openDamageAfterRemoval();
        const tombstone = tombstoneOf(harness.state());
        for (const amount of [2, 0]) {
            await expect(
                call(harness, setDamageAssignment, {
                    playerId: ME,
                    attackerId: "atk",
                    assignments: { giant: 4 - amount, [tombstone]: amount },
                })
            ).rejects.toThrow(/is not a legal damage target for atk/);
        }
        expect(harness.state().combat!.damageAssignments).toEqual({
            atk: { giant: 4 },
        });
    });

    it("setDamageAssignment still refuses the defending player to a non-trampler (CR 510.1c)", async () => {
        const harness = await openDamageAfterRemoval();
        await expect(
            call(harness, setDamageAssignment, {
                playerId: ME,
                attackerId: "atk",
                assignments: { giant: 2, [OPP]: 2 },
            })
        ).rejects.toThrow(/Only creatures with trample/);
    });
});
