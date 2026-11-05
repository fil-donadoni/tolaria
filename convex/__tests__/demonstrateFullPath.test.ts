// Full path for Demonstrate (CR 702.144a, CR 707.10c): the REGISTERED `game.ts`
// mutations cast the spell, answer the "you may copy it", keep one copy's targets
// and re-aim the other, and the client sees each offer through
// `projectPublicState`. The stub persists the compact form, so the queued offer
// survives a serialization round trip at every save point on the way.
import { describe, expect, it } from "vitest";
import {
    announceCast,
    cancelTarget,
    passPriority,
    selectTargets,
    submitMayPay,
} from "../game";
import { projectPublicState } from "../gameProjections";
import { preloadDefinitions } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { CardDefinition } from "../cards/types";
import { getPlayer, type GameState } from "../gre/state";
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
const SPELL = "synthetic-demonstrate-full-path";
const BEAR = "synthetic-demonstrate-full-path-bear";

preloadDefinitions([
    {
        id: SPELL,
        name: "Synthetic demonstrate spell",
        rarity: "rare",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        staticAbilities: ["demonstrate"],
        targetRequirement: { type: "Creature", count: 1 },
        effects: [{ op: "destroy", target: { target: 0 } }],
    } as CardDefinition,
    {
        id: BEAR,
        name: "Synthetic demonstrate bear",
        rarity: "common",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
    } as CardDefinition,
]);

const bear = (id: string, owner: string) =>
    makeInstance(BEAR, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });

function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [
                    makeInstance(SPELL, {
                        id: "spell",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    }),
                ],
                battlefield: [bear("mine", ME)],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer(OPP, { battlefield: [bear("theirs", OPP)] }),
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

/** Cast at "theirs", resolve the trigger, answer yes: the first offer is up. */
async function castAndCopy(harness: MutationStub): Promise<void> {
    await call(harness, announceCast, {
        playerId: ME,
        cardInstanceId: "spell",
    });
    await call(harness, selectTargets, {
        playerId: ME,
        targets: [{ targetType: "permanent", targetId: "theirs" }],
    });
    for (let guard = 0; guard < 4; guard++) {
        const live = harness.state();
        if ((live.pendingChoices?.length ?? 0) > 0) break;
        await call(harness, passPriority, { playerId: live.priorityPlayerId });
    }
    await call(harness, submitMayPay, { playerId: ME, accept: true });
}

describe("Demonstrate through the game mutations (CR 702.144a)", () => {
    it("each player re-aims their own copy, and the opponent's resolves first", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await castAndCopy(harness);

        // The caster is asked first; the opponent's offer survived the save.
        const first = harness.state();
        expect(first.pendingTarget?.playerId).toBe(ME);
        expect(first.queuedCopyRetargets).toHaveLength(1);
        const opponentCopy = first.stack.find((s) => s.controllerId === OPP)!;
        expect(first.queuedCopyRetargets).toEqual([opponentCopy.id]);

        // Keeping the targets is an answer: it hands the offer on, not priority.
        await call(harness, cancelTarget, { playerId: ME });
        const second = harness.state();
        expect(second.pendingTarget?.playerId).toBe(OPP);
        expect(second.pendingTarget?.cardInstanceId).toBe(opponentCopy.id);
        expect(second.queuedCopyRetargets).toBeUndefined();
        expect(
            projectPublicState(second, 1, OPP).pendingTarget?.cardInstanceId
        ).toBe(opponentCopy.id);

        await call(harness, selectTargets, {
            playerId: OPP,
            targets: [{ targetType: "permanent", targetId: "mine" }],
        });
        const aimed = harness.state();
        expect(aimed.pendingTarget).toBeUndefined();
        expect(aimed.priorityPlayerId).toBe(ME);

        // The opponent's copy kills "mine", the caster's kills "theirs", and
        // the original finds its target gone (CR 608.2b).
        for (let guard = 0; guard < 12; guard++) {
            const live = harness.state();
            if (live.stack.length === 0) break;
            await call(harness, passPriority, {
                playerId: live.priorityPlayerId,
            });
        }
        const end = harness.state();
        expect(end.stack).toEqual([]);
        expect(
            getPlayer(end, ME)
                .graveyard.map((c) => c.id)
                .sort()
        ).toEqual(["mine", "spell"]);
        expect(getPlayer(end, OPP).graveyard.map((c) => c.id)).toEqual([
            "theirs",
        ]);
    });
});
