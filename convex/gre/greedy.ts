// Greedy 1-ply move selection for the vs-AI Bot (ADR 0001, issue #111).
//
// `greedySelectMove(state, playerId, rand?)` is the Bot's "search" for this
// slice: it enumerates every legal macro-move (`enumerateMoves`), plays each one
// out on a sandbox clone (`applyMoveForSearch`), scores the resulting position
// with the heuristic (`evaluate`), and returns the highest-scoring move. Ties
// are broken at random (via `rand`) so the Bot is not robotically deterministic
// between equally-good lines, while staying a PURE function — given the same
// `rand` it always returns the same move, which is what the tests pin.
//
// This replaces the random-legal selection from issue #110: the Bot now blocks
// to survive/trade, avoids walking creatures into a wall, and casts the move
// that most improves its position. Full lookahead (opponent instant responses,
// multi-ply combat) is ISMCTS's job (issue #112); the seam here — enumerate →
// apply → evaluate → argmax — is exactly the one the search will reuse.

import type { GameState } from "./state";
import { enumerateMoves, type Move } from "./moves";
import { applyMoveForSearch } from "./applyMove";
import { evaluate } from "./evaluate";

/** Score every legal move one ply ahead and return the best for `playerId`, or
 *  null when the player owes no action. `rand` (default 0) breaks ties among
 *  equally-scored moves; pass `Math.random()` from the Worker for variety. */
export function greedySelectMove(
    state: GameState,
    playerId: string,
    rand = 0
): Move | null {
    const moves = enumerateMoves(state, playerId);
    if (moves.length === 0) return null;

    let bestScore = -Infinity;
    let best: Move[] = [];
    for (const move of moves) {
        const score = evaluate(
            applyMoveForSearch(state, playerId, move),
            playerId
        );
        if (score > bestScore) {
            bestScore = score;
            best = [move];
        } else if (score === bestScore) {
            best.push(move);
        }
    }

    const index = Math.min(best.length - 1, Math.floor(rand * best.length));
    return best[index];
}
