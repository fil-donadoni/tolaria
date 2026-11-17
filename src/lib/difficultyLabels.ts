import type { Difficulty } from "@convex/gre/difficulty";

/** The player-facing name of each Bot difficulty preset — the Match recap and
 *  the Limited setup / event detail render these. */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    medium: "Medium",
    hard: "Hard",
    expert: "Expert",
};

/** Shown on every setup surface that starts a game against a Bot, so the
 *  player is never surprised by a Bot that appears to read their hand: every
 *  played level knows the decklist (`DIFFICULTY_KNOWS_OPPONENT`,
 *  `convex/gre/difficulty.ts`). */
export const BOT_KNOWS_DECKLIST_LINE =
    "The Bot knows your decklist and plays around it.";
