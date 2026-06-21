import type { PublicMatch } from "@convex/matches";

// Play/draw choice UI state for the between-Games interstitial (#394, CR 103.4).
// The previous Game's loser (`match.playDrawChooserId`) chooses play or draw for
// the next Game. This pure helper decides, for a given viewer, whether to show
// the Play/Draw prompt, auto-continue (bot chooser), or wait on the opponent.

/** A seat belongs to the viewer when it equals their handle (2-player) or is one
 *  of their solo seats `${viewerId}-p1` / `${viewerId}-p2`. Mirrors the backend
 *  `matchBelongsToUser` seat test. */
function seatBelongsToViewer(seatId: string, viewerId: string): boolean {
    return seatId === viewerId || seatId.startsWith(`${viewerId}-`);
}

/** The bot seat in a vs-AI Match is `${userId}-p2` (ADR 0001). */
function isBotSeat(seatId: string): boolean {
    return seatId.endsWith("-p2");
}

export type InterstitialChoiceState =
    /** The viewer must pick play or draw before the next Game builds. */
    | { kind: "prompt" }
    /** The bot is the chooser → auto-continue with play, no prompt (#394). */
    | { kind: "auto" }
    /** The opponent (other human) is choosing → the viewer waits. */
    | { kind: "waiting" };

/**
 * Decide the interstitial play/draw UI for `viewerId`, given the Match meta.
 *
 * - In a vs-AI Match where the bot is the chooser → `auto` (server forces play).
 * - When the chooser seat belongs to the viewer (including the solo case, where
 *   the single user controls both seats) → `prompt`.
 * - Otherwise the opponent is choosing → `waiting`.
 *
 * Falls back to `auto` when no chooser is recorded (legacy / first-Game) so the
 * UI never strands the viewer without a way forward.
 */
export function interstitialChoiceState(
    match: Pick<PublicMatch, "playDrawChooserId" | "vsAi" | "solo">,
    viewerId: string
): InterstitialChoiceState {
    const chooserId = match.playDrawChooserId;
    if (chooserId === undefined) return { kind: "auto" };

    if (match.vsAi === true && isBotSeat(chooserId)) return { kind: "auto" };

    // Solo (non-AI): the single user controls both seats and always chooses.
    if (match.solo === true && match.vsAi !== true) return { kind: "prompt" };

    if (seatBelongsToViewer(chooserId, viewerId)) return { kind: "prompt" };

    return { kind: "waiting" };
}
