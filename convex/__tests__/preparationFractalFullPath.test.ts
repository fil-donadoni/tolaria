// Full path for Jadzi, Steward of Fate // Oracle's Gift (CR 722, issue #3690):
// the REGISTERED `game.ts` mutations cast the exiled prepare-spell copy
// (CR 722.3c) with X chosen at announcement (CR 107.3). The client sees,
// through `projectPublicState`, the new 0/0 Fractals carrying their counters
// and the pre-existing Fractal carrying them too — Oracle's Gift counts "each
// Fractal you control", not only the tokens it just made.
import { describe, expect, it } from "vitest";
import { announceCast, passPriority } from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import { insetSpellDefinitionId } from "../cards/insetSpell";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getEffectiveToughness } from "../gre/layers";
import { FRACTAL_TOKEN } from "../cards/sharedTokens";
import { createTokenPermanents, getPlayer, type GameState } from "../gre/state";
import type { TokenSpec } from "../cards/types";
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
const JADZI = getCardByName("Jadzi, Steward of Fate").id;
const GIFT = insetSpellDefinitionId(JADZI, "prepare");

/** My main phase, Jadzi on the battlefield prepared with the exiled copy of
 *  Oracle's Gift castable, a 1/1 Fractal already in play, {4}{U} floating. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer(ME, {
                battlefield: [
                    makeInstance(JADZI, {
                        id: "jadzi",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "battlefield",
                        prepared: true,
                    }),
                ],
                exile: [
                    makeInstance(GIFT, {
                        id: "gift",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "exile",
                        castableFromExileBy: ME,
                        preparedCopyOf: "jadzi",
                    }),
                ],
                manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer(OPP, {}),
        ],
        activePlayerId: ME,
        priorityPlayerId: ME,
        phase: "PRECOMBAT_MAIN",
    });
    createTokenPermanents(
        state,
        {
            ...FRACTAL_TOKEN,
            power: 0,
            toughness: 0,
            triggeredAbilities: undefined,
            activatedAbilities: undefined,
        } as TokenSpec,
        ME,
        1
    );
    const old = getPlayer(state, ME).battlefield.find((c) => c.isToken)!;
    old.id = "old-fractal";
    old.counters = { "+1/+1": 1 };
    return state;
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

async function resolveStack(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
}

describe("Oracle's Gift through the game mutations (CR 722, issue #3690)", () => {
    it("X=2 from the exiled copy: two new Fractals survive as 2/2 and the older one gains two counters", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: "gift",
            chosenX: 2,
        });
        await resolveStack(harness);

        const state = harness.state();
        const mine = getPlayer(state, ME);
        const tokens = mine.battlefield.filter(
            (c) => c.isToken && c.id !== "old-fractal"
        );
        expect(tokens).toHaveLength(2);
        const view = projectPublicState(state, 1, ME);
        const shown = view.players.find((p) => p.id === ME)!.battlefield;
        for (const t of tokens) {
            const slim = shown.find((c) => c.id === t.id)!;
            expect(getEffectiveToughness(view, slim)).toBe(2);
        }
        const old = shown.find((c) => c.id === "old-fractal")!;
        expect(getEffectiveToughness(view, old)).toBe(3);
        expect(
            getPlayer(state, ME).battlefield.find((c) => c.id === "jadzi")!
                .prepared
        ).toBeUndefined();
    });

    it("X=0: no tokens, no counters, and the cast still unprepares Jadzi (CR 601.2i)", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: "gift",
            chosenX: 0,
        });
        await resolveStack(harness);

        const state = harness.state();
        const mine = getPlayer(state, ME);
        expect(mine.battlefield.filter((c) => c.isToken)).toHaveLength(1);
        const view = projectPublicState(state, 1, ME);
        const old = view.players
            .find((p) => p.id === ME)!
            .battlefield.find((c) => c.id === "old-fractal")!;
        expect(getEffectiveToughness(view, old)).toBe(1);
        expect(
            mine.battlefield.find((c) => c.id === "jadzi")!.prepared
        ).toBeUndefined();
    });
});
