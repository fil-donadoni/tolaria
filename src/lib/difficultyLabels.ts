import type { Difficulty } from "@convex/gre/difficulty";

/** The player-facing name of each Bot difficulty preset — the lobby selector,
 *  the Match recap and the Limited setup / event detail all render these. */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
    expert: "Expert",
};
