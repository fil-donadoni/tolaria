// Full path for CR 722 Preparation (issue #3687): the REGISTERED `game.ts`
// mutations cast Skycoach Conductor, which enters prepared (CR 722.3a) and
// leaves its controller a copy of All Aboard in exile (CR 722.3c); the same
// mutations then cast that copy from exile at a Grizzly Bears. The client sees,
// through `projectPublicState`, the castable copy, then the Bears flickered,
// the Conductor unprepared and no copy anywhere (CR 704.5e).
import { describe, expect, it } from "vitest";
import { announceCast, passPriority, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { getCardByName } from "../cards";
import { insetSpellDefinitionId } from "../cards/insetSpell";
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

const GAME = "game-1" as Id<"games">;
const ME = "u-p1";
const OPP = "u-p2";
const CONDUCTOR = getCardByName("Skycoach Conductor").id;
const ALL_ABOARD = insetSpellDefinitionId(CONDUCTOR, "prepare");

const card = (
    name: string,
    instanceId: string,
    owner: string,
    zone: "hand" | "battlefield" | "library"
) =>
    makeInstance(getCardByName(name).id, {
        id: instanceId,
        controllerId: owner,
        ownerId: owner,
        zone,
    });

/** My main phase: the Conductor in hand, {U}{U}{U}{U} floating, a Grizzly
 *  Bears on my battlefield. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer(ME, {
                hand: [card("Skycoach Conductor", "conductor", ME, "hand")],
                battlefield: [
                    card("Grizzly Bears", "bears", ME, "battlefield"),
                ],
                library: [card("Island", "my-lib-0", ME, "library")],
                manaPool: { W: 0, U: 4, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer(OPP, {
                library: [card("Mountain", "opp-lib-0", OPP, "library")],
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

async function resolveStack(harness: MutationStub): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
        const live = harness.state();
        if (live.stack.length === 0) return;
        await call(harness, passPriority, {
            playerId: live.priorityPlayerId,
        });
    }
}

describe("Preparation through the game mutations (CR 722, issue #3687)", () => {
    it("cast the Conductor → cast All Aboard from exile → the target is flickered, the Conductor unprepared, no copy remains", async () => {
        const harness = makeMutationCtx("u", [gameStateSeed(board())]);

        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: "conductor",
        });
        await resolveStack(harness);

        // CR 722.3a / 722.3c — on the battlefield, prepared, with the copy in
        // its controller's exile, offered to me and only to me.
        let view = projectPublicState(harness.state(), 1, ME);
        let mine = view.players.find((p) => p.id === ME)!;
        expect(
            mine.battlefield.find((c) => c.id === "conductor")!.prepared
        ).toBe(true);
        const copy = mine.exile.find((c) => c.card.id === ALL_ABOARD)!;
        expect(copy).toBeDefined();
        expect(copy.castableFromExileBy).toBe(ME);

        if (harness.state().priorityPlayerId !== ME) {
            await call(harness, passPriority, {
                playerId: harness.state().priorityPlayerId,
            });
        }
        await call(harness, announceCast, {
            playerId: ME,
            cardInstanceId: copy.id,
        });
        await call(harness, selectTargets, {
            playerId: ME,
            targets: [{ targetType: "permanent", targetId: "bears" }],
        });
        // CR 601.2i — unprepared as the spell becomes cast, before it
        // resolves; the stack shows the prepare spell itself.
        expect(harness.state().stack.map((i) => i.card.id)).toEqual([
            ALL_ABOARD,
        ]);
        expect(
            getPlayer(harness.state(), ME).battlefield.find(
                (c) => c.id === "conductor"
            )!.prepared
        ).toBeUndefined();
        await resolveStack(harness);

        const state = harness.state();
        expect(state.stack).toHaveLength(0);
        view = projectPublicState(state, 1, ME);
        mine = view.players.find((p) => p.id === ME)!;
        // CR 400.7 — the Bears came back as a new object: it entered this turn.
        const bears = mine.battlefield.find(
            (c) => c.card.id === getCardByName("Grizzly Bears").id
        )!;
        expect(bears.isSummoningSick).toBe(true);
        expect(
            mine.battlefield.find((c) => c.id === "conductor")!.prepared
        ).toBeUndefined();
        // CR 704.5e — the copy is in no zone, and no graveyard holds it.
        for (const p of view.players) {
            expect(p.exile.map((c) => c.card.id)).not.toContain(ALL_ABOARD);
            expect(p.graveyard.map((c) => c.card.id)).not.toContain(ALL_ABOARD);
        }
    });
});
