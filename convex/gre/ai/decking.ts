// The decking term (CR 104.3c / 704.5b), one authority for the leaf
// evaluator (`evaluate.ts`) and the Differential Reading's mill side reader
// (`EachPlayerSide.millLoss`, issue #5625): what a library card lost now
// costs is what the evaluator charges for the shorter library.
import type { GameState, PlayerState } from "../state";
import type { EvalWeights } from "./evalWeights";

type DeckingWeights = Pick<EvalWeights, "deckingHorizon" | "deckingWeight">;

/** CR 104.3c / 704.5b — the cost of a library running out.
 *
 *  A player who must draw from an empty library loses, so the cards left in it
 *  are a resource exactly like life, and milling is a way to win. Before this
 *  term the evaluator could not see a library AT ALL: measured on the probe
 *  board, `evaluate` returned the identical 25.0000 for an opponent library of
 *  40, of 1 and of 0, while an opponent at 1 life scored 177 — so no amount of
 *  search could ever find a mill kill, because the objective did not exist in
 *  the value function.
 *
 *  NARROW SUPPORT (ADR 0070 §5), like `lethalUnblockedDelta` below: exactly
 *  zero at or above `deckingHorizon`, so an ordinary game is byte-identical
 *  and no global weight is touched. Quadratic below it, so the gradient is
 *  shallow where decking is theoretical and steep where it decides the game —
 *  the shape `dangerClock` already uses for the life race. Negative for the
 *  player who is short: `evaluate` takes my score minus the opponent's, so
 *  milling THEM raises my score and milling MYSELF lowers it, with no
 *  special-casing of who is who. */
/** Phases in which the ACTIVE player has not yet taken their draw step, so the
 *  next draw in the game is theirs. Spelled out rather than imported: the phase
 *  order is a module-local const in `phases.ts`, and this only needs the cut at
 *  DRAW. CR 103.8a's skipped first draw is deliberately ignored — this is a
 *  leaf heuristic, and turn one is not a decking endgame. */
const PHASES_BEFORE_ACTIVE_DRAW: ReadonlySet<string> = new Set([
    "MULLIGAN",
    "UNTAP",
    "UPKEEP",
    "DRAW",
]);

/** Whose draw step comes NEXT (CR 504.1). The whole reason decking is a RACE
 *  rather than a resource: with both libraries equally short, the player who
 *  draws first is the one who loses. */
function playerDrawingNext(state: GameState): string | undefined {
    const active = state.activePlayerId;
    if (PHASES_BEFORE_ACTIVE_DRAW.has(state.phase)) return active;
    return state.players.find((p) => p.id !== active)?.id;
}

/** `player`'s decking term with `remaining` cards in its library — the one it
 *  holds now by default; issue #5625 reads it at the size a mill leaves. */
export function libraryTerm(
    state: GameState,
    player: PlayerState,
    weights: DeckingWeights,
    remaining: number = player.library.length
): number {
    // Half a draw of handicap to whoever draws FIRST, so two equally short
    // libraries no longer cancel exactly: the player about to draw is strictly
    // worse off, which is the truth (CR 104.3c) and is what stops the bot
    // treating "mill us both out" as neutral.
    const effective =
        remaining + (playerDrawingNext(state) === player.id ? 0 : 0.5);
    if (effective >= weights.deckingHorizon) return 0;
    const deficit = weights.deckingHorizon - effective;
    return -weights.deckingWeight * deficit * deficit;
}
// CALIBRATION. `deckingWeight` is sized so this term's whole range —
// `deckingHorizon² · deckingWeight` ≈ 216 — stays well inside
// `weights.materialFull` (500), the cap `materialSignal` (`search.ts`) clips
// at. At the original 4 the range was 576, so on a WON leaf the opponent's
// empty-library penalty alone saturated the band: every continuation mapped to
// the identical reward 1.0 and the search could not tell "keep my own library"
// from "mill myself too". Measured on a 9/9 Underworld Breach board,
// `v - winScore` now runs +384.6 → +348.6 → +285.6 → +228.6 → +195.6 as the
// bot's own library is spent, so the won band orders them and surplus storm
// copies stop being pointed at their own controller by rollout noise.
