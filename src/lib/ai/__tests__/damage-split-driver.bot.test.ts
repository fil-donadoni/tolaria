// The Bot's combat-damage split through the REAL driver path (issue #5662):
// the bot-viewpoint projection → `realiseBotAction`'s `confirm-combat-damage`
// realisation → the registered `setDamageAssignment` and `confirmDamage`
// mutations (their own `_handler`s, `gameMutationHarness.fixture.ts`).
//
// `bun run cr 510.1c`: a creature blocked by two or more creatures "assigns
// its combat damage to those creatures divided as its controller chooses among
// them". `bun run cr 510.1d`: the same for a blocker blocking two or more.
// The driver used to confirm the engine's seed (all damage on the first live
// blocker) unedited; it now submits the policy's split first (ADR 0074: the
// server re-validates it — a rejected shape throws here).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import {
    hillGiant,
    monssGoblinRaiders,
} from "@convex/cards/sets/lea/red.cards";
import { grizzlyBears, warMammoth } from "@convex/cards/sets/lea/green.cards";
import { savannahLions } from "@convex/cards/sets/lea/white.cards";
import { setDamageAssignment, confirmDamage } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { buildDefaultDamageAssignments } from "@convex/gre/phases";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { Id } from "@convex/_generated/dataModel";
import { realiseBotAction, type RealisationContext } from "../realise";

const GAME_ID = "game-1" as Id<"games">;

function permanent(
    defId: string,
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** p1 attacks with `attackers`, p2 blocks per `blocks`; the combat damage step
 *  is open with the engine's own seed, as the step's entry leaves it. */
function damageStep(
    attackers: CardInstanceState[],
    blockers: CardInstanceState[],
    blocks: Record<string, string[]>,
    assigners: Record<string, string>
): GameState {
    const state = makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: attackers.map((a) => ({
                    ...a,
                    isAttacking: true,
                })),
            }),
            makePlayer("p2", {
                battlefield: blockers.map((b) => ({ ...b, isBlocking: true })),
            }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: blocks,
            blockersConfirmed: true,
            blockedAttackerIds: attackers.map((a) => a.id),
            damageConfirmed: false,
            damageAssignments: {},
            damageAssignerIds: assigners,
            damageAssignmentConfirmedBy: [],
        },
    });
    state.combat!.damageAssignments = buildDefaultDamageAssignments(
        state,
        "regular"
    );
    return state;
}

/** Realise the bot's `confirm-combat-damage` for `botId` against the real
 *  mutations; returns the submitted splits and the state afterwards. */
async function realiseDamage(
    state: GameState,
    botId: string,
    refuseSplits = false
) {
    const h = makeMutationCtx(botId, [gameStateSeed(state)]);
    const submitted: { attackerId: string; assignments: unknown }[] = [];
    const calls: string[] = [];
    const ctx = {
        gameId: GAME_ID,
        botId,
        botState: projectPublicState(state, 1, botId),
        direct: {
            setDamageAssignment: (a: {
                gameId: Id<"games">;
                playerId: string;
                attackerId: string;
                assignments: Record<string, number>;
            }) => {
                calls.push("setDamageAssignment");
                submitted.push({
                    attackerId: a.attackerId,
                    assignments: a.assignments,
                });
                if (refuseSplits) {
                    return Promise.reject(new Error("refused by the server"));
                }
                return runMutation(setDamageAssignment, h.ctx, a);
            },
            confirmDamage: (a: { gameId: Id<"games">; playerId: string }) => {
                calls.push("confirmDamage");
                return runMutation(confirmDamage, h.ctx, a);
            },
        },
    } as unknown as RealisationContext;
    const runner = realiseBotAction({ kind: "confirm-combat-damage" }, ctx);
    expect(runner).not.toBeNull();
    await runner!();
    return { submitted, calls, after: h.state() as GameState };
}

const ids = (cards: CardInstanceState[]) => cards.map((c) => c.id).sort();

describe("driver: confirm-combat-damage submits the Bot's split (issue #5662)", () => {
    it("3/3 blocked by a 1/1 and a 2/1: assigns 1 and 2, both blockers die (CR 510.1c)", async () => {
        const state = damageStep(
            [permanent(hillGiant().id, "atk", "p1")],
            [
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
                permanent(savannahLions().id, "lions", "p2"),
            ],
            { goblin: ["atk"], lions: ["atk"] },
            { atk: "p1" }
        );
        const { submitted, calls, after } = await realiseDamage(state, "p1");
        expect(calls).toEqual(["setDamageAssignment", "confirmDamage"]);
        expect(submitted).toEqual([
            { attackerId: "atk", assignments: { goblin: 1, lions: 2 } },
        ]);
        expect(ids(after.players[1].graveyard)).toEqual(["goblin", "lions"]);
    });

    it("trample: lethal to each blocker, the excess to the defending player (CR 702.19b)", async () => {
        const state = damageStep(
            [permanent(warMammoth().id, "atk", "p1")],
            [
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
                permanent(savannahLions().id, "lions", "p2"),
            ],
            { goblin: ["atk"], lions: ["atk"] },
            { atk: "p1" }
        );
        const before = state.players[1].life;
        const { after } = await realiseDamage(state, "p1");
        expect(ids(after.players[1].graveyard)).toEqual(["goblin", "lions"]);
        expect(after.players[1].life).toBe(before - 1);
    });

    it("the Bot as the defender, its blocker blocking two attackers (CR 510.1d)", async () => {
        const state = damageStep(
            [
                permanent(grizzlyBears().id, "bears", "p1"),
                permanent(savannahLions().id, "lions", "p1"),
            ],
            [permanent(hillGiant().id, "giant", "p2")],
            { giant: ["bears", "lions"] },
            { giant: "p2" }
        );
        const { submitted, after } = await realiseDamage(state, "p2");
        expect(submitted).toEqual([
            { attackerId: "giant", assignments: { bears: 2, lions: 1 } },
        ]);
        expect(ids(after.players[0].graveyard)).toEqual(["bears", "lions"]);
    });

    it("confirms the server's default when a split is refused, rather than stalling", async () => {
        const state = damageStep(
            [permanent(hillGiant().id, "atk", "p1")],
            [
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
                permanent(savannahLions().id, "lions", "p2"),
            ],
            { goblin: ["atk"], lions: ["atk"] },
            { atk: "p1" }
        );
        const { calls, after } = await realiseDamage(state, "p1", true);
        expect(calls).toEqual(["setDamageAssignment", "confirmDamage"]);
        // The seed (all 3 on the first blocker) was confirmed and applied.
        expect(after.combat?.damageConfirmed).not.toBe(false);
        expect(ids(after.players[1].graveyard)).toEqual(["goblin"]);
    });

    it("submits nothing when the seed already is the split, and still confirms", async () => {
        // 3/3 into a 3/3 and a 1/1: the policy kills the 3/3 — which the
        // engine's seed (first live blocker) already does.
        const state = damageStep(
            [permanent(hillGiant().id, "atk", "p1")],
            [
                permanent(hillGiant().id, "giant", "p2"),
                permanent(monssGoblinRaiders().id, "goblin", "p2"),
            ],
            { giant: ["atk"], goblin: ["atk"] },
            { atk: "p1" }
        );
        const { calls, after } = await realiseDamage(state, "p1");
        expect(calls).toEqual(["confirmDamage"]);
        expect(ids(after.players[1].graveyard)).toEqual(["giant"]);
    });
});
