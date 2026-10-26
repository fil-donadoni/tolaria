// The Bot difficulty of a Limited Event (issue #6916): chosen once at setup,
// fixed for the event's life, and bound to every vs-AI Match the event starts
// (round pairing vs a Bot seat, "Play vs the Table"). Reuses the lobby's
// presets (`convex/gre/difficulty.ts`) — no new presets.
//
// The mutation shell, the projection and the Match builders all resolve
// through here, so the validator and the legacy-row default live in exactly
// one place.

import { v } from "convex/values";
import type { Difficulty } from "../gre/difficulty";

/** The lobby default, spelled out here rather than imported: this module is
 *  reached by `convex/gameReads.ts`, which must not reach the engine (issue
 *  #4855). `limitedEventBotDifficulty.test.ts` pins it to `DEFAULT_DIFFICULTY`. */
const DEFAULT_EVENT_BOT_DIFFICULTY: Difficulty = "medium";

/** Wire/storage shape of a `Difficulty`. Four literals, written out because
 *  `v.union` needs a tuple; `Infer` pins it to `Difficulty` at the call sites
 *  that assign one to the other, so a new preset is a `tsc` error. */
export const difficultyValidator = v.union(
    v.literal("easy"),
    v.literal("medium"),
    v.literal("hard"),
    v.literal("expert")
);

/** Stored (optional) event difficulty resolved to a definite one. The schema
 *  field is optional for backward compatibility with events created before
 *  this field existed; they resolve to the lobby default (`medium`), like
 *  `resolveGamesFormat`. */
export function resolveEventBotDifficulty(event: {
    botDifficulty?: Difficulty;
}): Difficulty {
    return event.botDifficulty ?? DEFAULT_EVENT_BOT_DIFFICULTY;
}
