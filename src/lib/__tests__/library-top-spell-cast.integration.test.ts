// End-to-end integration for the cast-from-TOP-of-library capability
// (CR 601.3 — Bolas's Citadel, issue #2398): GRE → `convex/game.ts` →
// the UI render model.
//
// The GRE-level and wire-level assertions live in
// `convex/cards/sets/war/__tests__/black.test.ts`. What THIS file exists for is
// the boundary crossing those cannot see: the affordance can be correct in
// `projectPublicState` and still be dead on the board, because the client never
// sees `GameState` — it sees what the `getPublicState` QUERY returns, fed into
// a client reducer. The whole path runs here for real:
//
//   1. GRE — a real `GameState` with a Citadel on the battlefield, persisted
//      through `compactState` into a `gameStates` row (the serialization the DB
//      actually stores);
//   2. game.ts — the REGISTERED `getPublicState` query's own `_handler`, driven
//      against a stub ctx, once per SEAT;
//   3. UI — `buildLibraryPileModel` (`src/lib/library-knowledge.ts`), the
//      reducer `player-library.tsx` actually calls, whose slot cards are what
//      `renderCardAction` receives. `LibraryCastButton` gates purely on
//      `card.legalActions?.includes("cast")`, so the slot card carrying (or
//      losing) that field IS the button appearing or not.
//
// Beyond the land sibling (`library-top-land-play.integration.test.ts`) this
// also has to prove the ASYMMETRY: Citadel's top-card look is controller-only
// (CR 401.5's "may look at" half, not its "revealed" half), so the OPPONENT'S
// slot must come back face-DOWN, not merely affordance-free.

import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import { getPublicState } from "@convex/game";
import { compactState } from "@convex/gre/serialize";
import type { GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { bolassCitadel } from "@convex/cards/sets/war/black";
import { forest } from "@convex/cards/sets/lea/colorless";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import {
    makeMutationCtx,
    gameStateSeed,
} from "@convex/__tests__/gameMutationHarness";
import { buildLibraryPileModel } from "~/lib/library-knowledge";
import type { PublicLibrary } from "~/types/game";

const GAME_ID = "game-1" as Id<"games">;

type PublicStateArgs = {
    gameId: Id<"games">;
    playerId: string;
    debugAllActions?: boolean;
};
type QueryHandler = {
    _handler: (
        ctx: MutationCtx,
        args: PublicStateArgs
    ) => Promise<{
        players: { id: string; library: PublicLibrary }[];
    } | null>;
};

/** A `games` row for a NON-solo two-player match, so `getPublicState` honors
 *  the requested `playerId` as the viewer instead of following priority. */
const gameSeed = () => ({
    _id: "game-1",
    __table: "games",
    solo: false,
    vsAi: false,
});

/** Drive the registered `getPublicState` query end-to-end for one seat, then
 *  run the pile reducer the component itself calls, and return exactly what
 *  the top slot hands `renderCardAction`: whether it is face-up, which card it
 *  is, and its `legalActions` (`undefined` = no button at all; `[]` = the
 *  button renders disabled). */
async function topSlotFor(
    state: GameState,
    viewerId: string,
    libraryOwnerId: string
): Promise<{
    faceUp: boolean;
    cardId: string | undefined;
    legalActions: string[] | undefined;
    castManaCostReplaced: true | undefined;
}> {
    const { ctx } = makeMutationCtx("user-1", [
        gameSeed(),
        {
            ...gameStateSeed(state),
            state: compactState(state) as unknown as GameState,
        },
    ]);
    const projected = await (
        getPublicState as unknown as QueryHandler
    )._handler(ctx, { gameId: GAME_ID, playerId: viewerId });
    const owner = projected!.players.find((p) => p.id === libraryOwnerId)!;
    const pile = buildLibraryPileModel(owner.library as never, libraryOwnerId);
    const top = pile[0];
    return {
        faceUp: top.faceUp,
        cardId: (top.card.card as { id?: string } | undefined)?.id,
        legalActions: top.card.legalActions,
        castManaCostReplaced: top.card.castManaCostReplaced,
    };
}

function citadelBoard(libraryIds: string[], withCitadel = true, life = 20) {
    return makeState({
        players: [
            makePlayer("p1", {
                life,
                battlefield: withCitadel
                    ? [
                          makeInstance(bolassCitadel.id, {
                              controllerId: "p1",
                              ownerId: "p1",
                              id: "citadel",
                          }),
                      ]
                    : [],
                library: libraryIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        controllerId: "p1",
                        ownerId: "p1",
                        id: `p1-lib-${i}`,
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("cast-from-top-of-library end-to-end (CR 601.3, Bolas's Citadel)", () => {
    it("the controller's own top-of-library spell arrives face-up with a CASTABLE affordance", async () => {
        const state = citadelBoard([grizzlyBears.id, forest.id]);
        const top = await topSlotFor(state, "p1", "p1");
        expect(top.faceUp).toBe(true);
        expect(top.cardId).toBe(grizzlyBears.id);
        expect(top.legalActions).toContain("cast");
        // CR 118.9-analog / 107.3b / 601.2b — the flag survives the QUERY and
        // the pile reducer, which is the only route by which `useHandCardCommit`
        // can learn this cast pays life instead of mana. Dropped here, the X
        // stepper and the alternative-cost picker come back (both illegal).
        expect(top.castManaCostReplaced).toBe(true);
    });

    it("CR 401.5 — the OPPONENT sees a face-DOWN top card: the look is controller-only", async () => {
        const state = citadelBoard([grizzlyBears.id, forest.id]);
        const top = await topSlotFor(state, "p2", "p1");
        expect(top.faceUp).toBe(false);
        expect(top.cardId).not.toBe(grizzlyBears.id);
        expect(top.legalActions).toBeUndefined();
    });

    it("no visibility and no affordance without a Citadel on the battlefield", async () => {
        const state = citadelBoard([grizzlyBears.id, forest.id], false);
        const top = await topSlotFor(state, "p1", "p1");
        expect(top.faceUp).toBe(false);
        expect(top.legalActions).toBeUndefined();
    });

    it("CR 305.9 — a top LAND is face-up but carries 'play', never 'cast'", async () => {
        const state = citadelBoard([forest.id, grizzlyBears.id]);
        const top = await topSlotFor(state, "p1", "p1");
        expect(top.faceUp).toBe(true);
        expect(top.legalActions).toContain("play");
        expect(top.legalActions).not.toContain("cast");
        expect(top.castManaCostReplaced).toBeUndefined();
    });

    it("CR 119.4 — renders DISABLED (present but empty) when the life total can't cover the cost", async () => {
        // Still visible and still "castable in principle", just not right now:
        // the button must appear greyed rather than vanish, and that
        // distinction is carried entirely by present-but-empty vs. absent.
        const state = citadelBoard([grizzlyBears.id, forest.id], true, 1);
        const top = await topSlotFor(state, "p1", "p1");
        expect(top.faceUp).toBe(true);
        expect(top.legalActions).toEqual([]);
    });
});
