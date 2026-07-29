// Shared Urza's Saga (#1884) test fixtures used by BOTH the application suite
// (`colorless.test.ts`) and the bot suite (`colorless.bot.test.ts` — the real
// payment-planner assertion, `convex/gre/moves` is bot-only per
// `scripts/__tests__/bot-suite-boundary.test.ts`). Kept as a small shared
// helper next to the two files rather than duplicated, per the project's
// "import from setup, don't copy fixtures" convention — these two are
// Saga-specific (not general enough for `cards/__tests__/setup.ts`).

import { urzasSaga } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    advanceSagasAtPrecombatMain,
    LORE_COUNTER,
} from "../../../../gre/sagas";

/** The Saga on the battlefield with `lore` counters already on it, plus any
 *  extra permanents / library. Built through the shared fixtures so the state
 *  carries a real Expected Input (ADR 0047). */
export function sagaBoard(opts: {
    lore?: number;
    battlefield?: CardInstanceState[];
    library?: CardInstanceState[];
    opponentBattlefield?: CardInstanceState[];
}): { state: GameState; saga: CardInstanceState } {
    const saga = makeInstance(urzasSaga.id, {
        id: "saga-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...(opts.lore !== undefined
            ? { counters: { [LORE_COUNTER]: opts.lore } }
            : {}),
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [saga, ...(opts.battlefield ?? [])],
                library: opts.library ?? [],
            }),
            makePlayer("p2", { battlefield: opts.opponentBattlefield ?? [] }),
        ],
    });
    return { state, saga: state.players[0].battlefield[0] };
}

/** One CR 714.3c turn-based lore counter, the chapter trigger it raises put on
 *  the stack (CR 603.2), and that chapter resolved — the exact pair
 *  `performPhaseEntry`'s PRECOMBAT_MAIN case runs. */
export function tickChapter(state: GameState): void {
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}
