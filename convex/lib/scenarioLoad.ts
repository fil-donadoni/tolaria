/**
 * Load a declared position (a `ScenarioSpec`) into a live game — the body of
 * the Debug sheet's scenario load, shared with the `check:ui` seam
 * (issue #9272).
 *
 * Two callers, two gates, ONE build: `game.debugSetupScenario` opens on
 * `assertIsAdmin`, `uiSeam.loadPosition` on `assertUiSeamCaller` (local
 * deployment AND lane account). Each caller authorizes BEFORE calling this;
 * nothing here checks who is asking. What it does own is every refusal a
 * position earns on its own terms — a hidden hand a live game cannot hold
 * (CR 400.2), a built board nobody can act in (CR 103.5 / 117.3) — so the
 * lane's shortcut can never stage a board the sheet would have refused.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ScenarioSpec } from "../debugScenarioSpec";
import { widenGameDefinitionManifests } from "../definitionManifest";
import { withStatePrintIds } from "../deckStore";
import { getLatestGameState, saveGameState } from "../gameStateStore";
import type { GameState } from "../gre/state";
import {
    assertLiveGameCanContinue,
    assertLoadableIntoLiveGame,
    buildStateFromScenario,
} from "../gre/scenarioBuilder";
import { debugLoadMySeatId } from "../matches";

/** Builds `spec` over the game's latest state and saves it as the next `seq`.
 *  Returns that `seq`. The CALLER has already authorized the write. */
export async function loadScenarioIntoGame(
    ctx: MutationCtx,
    gameId: Id<"games">,
    spec: ScenarioSpec
): Promise<number> {
    // CR 400.2 (issue #3452) — a spec seeding cards of unknown identity is
    // refused HERE, before either DB read below, rather than at the spec
    // boundary: it is a valid spec, and the verdict quiz rebuilds it every
    // time. What it is not is a board a live game can hold.
    assertLoadableIntoLiveGame(spec);

    const gameState = await getLatestGameState(ctx, gameId);
    if (!gameState) throw new Error("Game not found");

    // WHICH SEAT renders as `"me"` (issue #3786). The immutable `games`
    // row, never the live snapshot's `players[]`: a `bot: "me"` Blade load
    // (`debugLoadBladeScenario`) reorders that array to orient its position
    // onto the Bot, and a Debug scenario loaded into the SAME game afterwards
    // must still render from the human viewer's point of view, whichever seat
    // that landed on.
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");
    const mySeatId = debugLoadMySeatId(game);

    // The actual state-construction logic lives in the pure
    // `buildStateFromScenario` (issue #1424, PRD #1423) so it's callable
    // from a vitest test with no Convex runtime AND from the mutations.
    const state = buildStateFromScenario(
        gameState.state as GameState,
        spec,
        mySeatId
    );
    // CR 117.3 / 508.1 (issue #3515) — and a second refusal over the BUILT
    // position: a spec carrying a stack is loadable, but a board whose
    // priority holder has no legal action is not a game, it is a frozen
    // client. Read after the build because the facts are the phase, the
    // priority holder and the combat object together.
    assertLiveGameCanContinue(state);

    // The Game-load Token Print query reads `games.cardIds` (issue #4120):
    // widen it to the position just staged, so its tokens keep their art.
    await ctx.db.patch(gameId, {
        cardIds: withStatePrintIds(game.cardIds, state),
    });
    // …and the Definition Manifest likewise (issue #5614): a card staged
    // from outside the decks must reach the client's loaded definitions.
    await widenGameDefinitionManifests(ctx, gameId, state);
    const seq = gameState.seq + 1;
    await saveGameState(ctx, gameId, seq, state, gameState);
    return seq;
}
