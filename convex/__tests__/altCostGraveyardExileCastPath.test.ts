// The alternative cost's GRAVEYARD exile leg (CR 118.9 / 601.2h / 701.13)
// across `game.ts`: "exile the top three black cards of your graveyard rather
// than pay this spell's mana cost", paid at cast commit with no payer pick.
//
// Both commit sites are driven through the REGISTERED mutation handlers (stub
// `MutationCtx`, `gameMutationHarness.fixture.ts`): the untargeted cast commits
// inside `announceCast`'s alternative-cost branch, the targeted one in
// `finalizeTargetSelection` after `selectTarget`. The full-path test through
// the wire projection and the client gate is
// `src/lib/__tests__/alt-cost-graveyard-exile.fullpath.test.ts`.

import { describe, expect, it } from "vitest";
import { announceCast, selectTarget } from "../game";
import { getCardByName } from "../cards";
import { makePlayer, makeState } from "../cards/__tests__/setup.helper";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import {
    ALT_GRAVEYARD_EXILE_TARGETED_ID,
    ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
    EXILE_TOP_THREE_BLACK,
    ownedCard,
} from "../gre/__tests__/fixtures/altCostGraveyardExileProbe.fixture";

const GAME_ID = "game-1" as Id<"games">;
const RITUAL = getCardByName("Dark Ritual").id;
const TERROR = getCardByName("Terror").id;
const VAMPIRE = getCardByName("Sengir Vampire").id;
const BEARS = getCardByName("Grizzly Bears").id;
const LIONS = getCardByName("Savannah Lions").id;

type AnnounceArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};
type SelectTargetArgs = {
    gameId: Id<"games">;
    playerId: string;
    targetType: "permanent";
    targetId: string;
};

/** p1 holds `probeId` and no lands; the graveyard (BOTTOM first) holds four
 *  black cards with non-black ones interleaved and a white card on top. p2
 *  controls Grizzly Bears, the targeted probe's nonblack creature. */
function board(probeId: string, graveyard = FOUR_BLACK): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [ownedCard(probeId, "probe", "p1", "hand")],
                graveyard: graveyard.map(([def, id]) =>
                    ownedCard(def, id, "p1", "graveyard")
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    ownedCard(BEARS, "p2-bears", "p2", "battlefield"),
                ],
            }),
        ],
    });
}

const FOUR_BLACK: [string, string][] = [
    [RITUAL, "oldest-black"],
    [RITUAL, "ritual"],
    [TERROR, "terror"],
    [BEARS, "bears"],
    [VAMPIRE, "vampire"],
    [LIONS, "lions"],
];

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    alternativeCostId: string | undefined
) {
    await runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "probe",
            alternativeCostId,
        }
    );
}

function expectPaid(state: GameState) {
    const p1 = state.players[0]!;
    // CR 701.13 — the three topmost black cards, top first; the fourth black
    // card (the oldest) and the non-black ones stay.
    expect(p1.exile.map((c) => c.id)).toEqual(["vampire", "terror", "ritual"]);
    expect(p1.graveyard.map((c) => c.id)).toEqual([
        "oldest-black",
        "bears",
        "lions",
    ]);
    expect(state.stack.map((s) => s.id)).toEqual(["probe"]);
    expect(p1.hand).toEqual([]);
    expect(state.pendingCast).toBeUndefined();
}

describe("alternative cost graveyard exile leg — game.ts (CR 118.9 / 601.2h)", () => {
    it("an UNTARGETED cast commits in announceCast, exiling the top three black cards", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(ALT_GRAVEYARD_EXILE_UNTARGETED_ID)),
        ]);
        await announce(harness, EXILE_TOP_THREE_BLACK.id);
        expectPaid(harness.state());
    });

    it("a TARGETED cast commits after selectTarget, exiling the top three black cards", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(ALT_GRAVEYARD_EXILE_TARGETED_ID)),
        ]);
        await announce(harness, EXILE_TOP_THREE_BLACK.id);
        // CR 601.2c — targets before costs: nothing is paid yet.
        expect(harness.state().players[0]!.exile).toEqual([]);
        expect(harness.state().pendingTarget).toBeDefined();
        await runMutation<SelectTargetArgs, void>(
            selectTarget as unknown as Handler<SelectTargetArgs, void>,
            harness.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                targetType: "permanent",
                targetId: "p2-bears",
            }
        );
        const after = harness.state();
        expectPaid(after);
        expect(after.stack[0]!.targets).toEqual([
            expect.objectContaining({ id: "p2-bears" }),
        ]);
    });

    it("refuses the alternative with fewer than three black cards in the graveyard", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(
                board(ALT_GRAVEYARD_EXILE_UNTARGETED_ID, [
                    [RITUAL, "ritual"],
                    [BEARS, "bears"],
                    [TERROR, "terror"],
                ])
            ),
        ]);
        await expect(
            announce(harness, EXILE_TOP_THREE_BLACK.id)
        ).rejects.toThrow();
        const after = harness.state();
        expect(after.players[0]!.exile).toEqual([]);
        expect(after.stack).toEqual([]);
    });
});
