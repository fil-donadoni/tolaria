import type { GameState } from "./state";
import { getOpponentId } from "./state";

/**
 * Check State-Based Actions related to game ending (CR 704.5).
 * Returns true if the game is over (sets state.gameOver).
 *
 * Checked conditions:
 * - CR 704.5a: A player with 0 or less life loses.
 * - CR 704.5b: A player who attempted to draw from an empty library loses.
 */
export function checkGameOverSBA(state: GameState): boolean {
    if (state.gameOver) return true;

    for (const player of state.players) {
        let reason: "life" | "decked" | null = null;

        if (player.life <= 0) {
            reason = "life";
        } else if (player.hasDrawnFromEmpty) {
            reason = "decked";
        }

        if (reason) {
            state.gameOver = {
                winnerId: getOpponentId(state, player.id),
                loserId: player.id,
                reason,
            };
            return true;
        }
    }

    return false;
}
