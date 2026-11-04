// Full path for issue #3658 (CR 707.10f / 608.3f): the REGISTERED `game.ts`
// mutations cast a spell and then Sage of the Skies on the stub `MutationCtx`,
// and the client sees a token Sage beside the original through
// `projectPublicState`. The stub persists the compact form, so every save point
// on the way is a serialization round trip too.
import { describe, expect, it } from "vitest";
import { announceCast, passPriority, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName, preloadDefinitions } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { sageOfTheSkies } from "../cards/sets/tdm/white.cards";
import { getEffectivePower, getEffectiveToughness } from "../gre/layers";
import { getPlayer, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkies()]);

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";
const SAGE_ID = sageOfTheSkies().id;

const card = (
    name: string,
    instanceId: string,
    owner: string,
    zone: "hand" | "library"
) =>
    makeInstance(getCardByName(name).id, {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

/** My main phase: a Lightning Bolt and a Sage in hand, the mana for both
 *  floating. The opponent holds a Counterspell and the mana for it. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    card("Lightning Bolt", "bolt", ME, "hand"),
                    makeInstance(SAGE_ID, {
                        id: "sage",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    }),
                ],
                library: [card("Plains", "my-lib-0", ME, "library")],
                manaPool: { W: 3, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer(OPP, {
                hand: [card("Counterspell", "counter", OPP, "hand")],
                library: [card("Island", "opp-lib-0", OPP, "library")],
                manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 },
            }),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
        phase: "PRECOMBAT_MAIN",
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

/** Everyone passes until the stack is empty. */
async function passUntilStackEmpty(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 16; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
    throw new Error("the stack never emptied");
}

/** Bolt the opponent, and resolve it: Sage is then the turn's second spell. */
async function castBoltThenSage(harness: MutationStub): Promise<void> {
    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "bolt",
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "player", targetId: OPP }],
    });
    await passUntilStackEmpty(harness);
    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "sage",
    });
}

describe("Sage of the Skies through the game mutations (issue #3658)", () => {
    it("as the second spell: the client sees a token Sage beside the original", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        await castBoltThenSage(harness);
        expect(
            harness
                .state()
                .stack.map((s) => s.triggeredAbilityId ?? "spell")
                .sort()
        ).toEqual(["sage-of-the-skies-copy", "spell"]);
        await passUntilStackEmpty(harness);

        const state = harness.state();
        const view = projectPublicState(state, 1, ME);
        const mine = view.players.find((p) => p.id === ME)!;
        const sages = mine.battlefield.filter(
            (c) => (c.card as { id: string }).id === SAGE_ID
        );
        expect(sages.map((c) => c.id === "sage")).toContain(true);
        expect(sages).toHaveLength(2);
        const token = sages.find((c) => c.isToken)!;
        expect(token.id).not.toBe("sage");
        expect(getEffectivePower(view, token)).toBe(2);
        expect(getEffectiveToughness(view, token)).toBe(3);
        expect(token.staticAbilities).toEqual(["flying", "lifelink"]);
        // CR 707.10 — only the two real casts count.
        expect(getPlayer(state, ME).spellsCastThisTurn).toBe(2);
    });

    it("countered in response: the Sage is in the graveyard and the token still arrives", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        await castBoltThenSage(harness);
        if (harness.state().priorityPlayerId === ME) {
            await call(harness, passPriority, { playerId: ME });
        }
        await call(harness, announceCast, {
            playerId: OPP,
            cardInstanceId: "counter",
        });
        await call(harness, selectTargets, {
            playerId: OPP,
            targets: [{ targetType: "spell", targetId: "sage" }],
        });
        await passUntilStackEmpty(harness);

        const state = harness.state();
        expect(getPlayer(state, ME).graveyard.map((c) => c.id)).toContain(
            "sage"
        );
        const view = projectPublicState(state, 1, ME);
        const mine = view.players.find((p) => p.id === ME)!;
        expect(mine.battlefield.map((c) => c.isToken)).toEqual([true]);
        expect((mine.battlefield[0].card as { id: string }).id).toBe(SAGE_ID);
    });
});
