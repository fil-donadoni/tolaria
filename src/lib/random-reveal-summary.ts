import { tryGetDefinition } from "@convex/cards";
import type { FlipRecord } from "@convex/gre/types";
import type { PendingChoice, Player } from "~/types/game";

/** How long the summary toast stays up after a Random Reveal closes. */
export const REVEAL_SUMMARY_MS = 4000;

/** "3 won, 1 lost" for a win/lose flipper; "2 heads, 1 tails" when the effect
 *  only read the face (CR 705.2: nobody wins or loses). */
function tally(flips: readonly FlipRecord[]): string {
    if (flips.every((flip) => flip.outcome === "none")) {
        const heads = flips.filter((flip) => flip.face === "heads").length;
        return `${heads} heads, ${flips.length - heads} tails`;
    }
    const won = flips.filter((flip) => flip.outcome === "win").length;
    const lost = flips.filter((flip) => flip.outcome === "lose").length;
    return `${won} won, ${lost} lost`;
}

/** The flips of a reveal, from its list or — for one saved before the list
 *  existed — from its single `result`. */
function revealFlips(choice: PendingChoice): FlipRecord[] {
    if (choice.flips && choice.flips.length > 0) return choice.flips;
    const heads = (choice.result ?? 0) === 1;
    return [
        {
            flipperId: choice.playerId,
            face: heads ? "heads" : "tails",
            outcome: heads ? "win" : "lose",
            round: 0,
        },
    ];
}

/** The one-line toast of a finished Random Reveal: source, each flipper's
 *  tally, then the realized consequence — "Squee's Revenge — You: 3 won, 1
 *  lost. Not every flip was won." Viewer-relative, client-only, never
 *  persisted (PRD issue #4433). */
export function formatRevealSummary(
    choice: PendingChoice,
    players: readonly Pick<Player, "id" | "name">[],
    viewerId: string
): string {
    const flips = revealFlips(choice);
    const source = choice.source
        ? (tryGetDefinition(choice.source.cardId)?.name ?? "Coin flip")
        : "Coin flip";
    const flipperIds = [...new Set(flips.map((flip) => flip.flipperId))];
    const tallies = flipperIds
        .map((id) => {
            const who =
                id === viewerId
                    ? "You"
                    : (players.find((p) => p.id === id)?.name ?? "Opponent");
            return `${who}: ${tally(flips.filter((f) => f.flipperId === id))}.`;
        })
        .join(" ");
    const consequence = choice.realized?.consequence;
    return [`${source} — ${tallies}`, consequence].filter(Boolean).join(" ");
}
