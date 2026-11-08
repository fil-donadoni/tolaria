import { useState } from "react";
import type { PendingChoice, Player } from "~/types/game";
import { formatRevealSummary } from "~/lib/random-reveal-summary";

export type RevealSummary = { key: string; message: string };

const revealKey = (choice: PendingChoice) =>
    `${choice.stackItemId}:${choice.choiceId}`;

/** The summary toast of a Random Reveal (CR 705.2, PRD issue #4433), for EVERY
 *  seat and every reveal, a single flip included. It watches the prompt slot:
 *  when a `random-reveal` stops being what the slot shows — the flipper's ack
 *  removed it, or a viewer's lingering overlay closed — it yields the finished
 *  reveal's one-line summary. Client-only, never persisted; tracked during
 *  render like the board's other derived notices. */
export function useRandomRevealSummary(
    promptChoice: PendingChoice | null | undefined,
    players: readonly Pick<Player, "id" | "name">[],
    viewerId: string
): { summary: RevealSummary | null; dismiss: () => void } {
    const [seen, setSeen] = useState<PendingChoice | null>(null);
    const [summary, setSummary] = useState<RevealSummary | null>(null);

    const current =
        promptChoice?.kind === "random-reveal" ? promptChoice : null;
    const finished =
        seen && (!current || revealKey(current) !== revealKey(seen))
            ? seen
            : null;
    if (finished) {
        setSummary({
            key: revealKey(finished),
            message: formatRevealSummary(finished, players, viewerId),
        });
    }
    if (finished || (current && !seen)) setSeen(current);

    return { summary, dismiss: () => setSummary(null) };
}
