// Full path for a shield whose preventions trigger (CR 615.1a / 603.7b),
// driven through the REAL Samite Ministration definition: the REGISTERED
// `game.ts` mutations cast a red burn spell at the caster, respond with the
// shield, answer the CR 609.7a source choice with the spell on the stack, and
// let the spell resolve. Its damage is prevented, the delayed trigger reaches
// the stack and the client sees it with its text through `projectPublicState`;
// resolving it gains the amount prevented. The stub persists the compact form,
// so the shield and its watch survive a serialization round trip at every
// save point on the way.
import { describe, expect, it } from "vitest";
import {
    announceCast,
    passPriority,
    selectTargets,
    submitResolutionChoice,
} from "../game";
import { projectPublicState } from "../gameProjections";
import { getDefinition, preloadDefinitions } from "../cards";
import { resolveCardExport } from "../cards/defineCard";
import { samiteMinistration } from "../cards/sets/inv/white.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getPlayer, type GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type MutationStub,
} from "./gameMutationHarness.fixture";

// The PR head carries no catalogue row for a newly shipped card (ADR 0157).
preloadDefinitions([resolveCardExport(samiteMinistration)!]);

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";
const SAMITE = "b1de62ed-79e6-4daf-a2ab-dc0726e1f7df";
const BOLT = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");
const TRIGGER_TEXT =
    "Whenever damage from a black or red source is prevented this way this turn, you gain that much life.";

function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                life: 20,
                hand: [
                    makeInstance(SAMITE, {
                        id: "samite",
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer(OPP, {
                hand: [
                    makeInstance(BOLT.id, {
                        id: "bolt",
                        controllerId: OPP,
                        ownerId: OPP,
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
        ],
        activePlayerId: OPP,
        priorityPlayerId: OPP,
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

/** Passes priority until `done` holds (a guard bounds the loop). */
async function passUntil(
    harness: MutationStub,
    done: (s: GameState) => boolean
): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
        const live = harness.state();
        if (done(live)) return;
        await call(harness, passPriority, { playerId: live.priorityPlayerId });
    }
    throw new Error("passUntil: condition never held");
}

describe("Samite Ministration through the game mutations (CR 615.1a / 603.7b)", () => {
    it("a prevented red spell's damage puts the trigger on the stack, visible to the client, and it gains that much life", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);
        await call(harness, announceCast, {
            playerId: OPP,
            cardInstanceId: "bolt",
        });
        await call(harness, selectTargets, {
            playerId: OPP,
            targets: [{ targetType: "player", targetId: ME }],
        });
        await passUntil(harness, (s) => s.priorityPlayerId === ME);
        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: "samite",
        });
        await passUntil(harness, (s) => (s.pendingChoices?.length ?? 0) > 0);

        // CR 609.7a — the source is chosen on resolution: the bolt on the stack.
        const choice = harness.state().pendingChoices![0];
        expect(choice.kind).toBe("pick-source");
        expect(choice.playerId).toBe(ME);
        await call(harness, submitResolutionChoice, {
            playerId: ME,
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["bolt"],
        });

        await passUntil(harness, (s) =>
            s.stack.some((i) => i.delayedTriggerId !== undefined)
        );
        const live = harness.state();
        expect(getPlayer(live, ME).life).toBe(20);
        const seen = projectPublicState(live, 1, ME).stack.find(
            (i) => i.delayedTriggerId !== undefined
        );
        expect(seen?.delayedOracleText).toBe(TRIGGER_TEXT);
        expect(seen?.controllerId).toBe(ME);

        await passUntil(harness, (s) => s.stack.length === 0);
        expect(getPlayer(harness.state(), ME).life).toBe(23);
    });
});
