// The Bot difficulty of a Limited Event (issue #6916): chosen once at setup,
// fixed for the event's life, and bound to every vs-AI Match the event starts
// (round pairing vs a Bot seat, "Play vs the Table"). Reuses the lobby's
// presets (`convex/gre/difficulty.ts`) — no new presets.
//
// The mutation shell, the projection and the Match builders all resolve
// through here, so the validators and the legacy-row default live in exactly
// one place.

import { v, type Infer } from "convex/values";
import type { Difficulty } from "../gre/difficulty";

/** The lobby default, spelled out here rather than imported: this module is
 *  reached by `convex/gameReads.ts`, which must not reach the engine (issue
 *  #4855). `limitedEventBotDifficulty.test.ts` pins it to `DEFAULT_DIFFICULTY`. */
const DEFAULT_EVENT_BOT_DIFFICULTY: Difficulty = "expert";

/** Wire shape of a `Difficulty`. Literals written out because `v.union` needs a
 *  tuple; `Infer` pins it to `Difficulty` at the call sites that assign one to
 *  the other, so a new preset is a `tsc` error. */
export const difficultyValidator = v.union(
    v.literal("medium"),
    v.literal("hard"),
    v.literal("expert")
);

/** Storage shape: a `Difficulty`, or the retired `easy` preset a row written
 *  before its removal may still carry. Schema validation checks those rows at
 *  deploy, so the literal stays accepted here; nothing writes it and no reader
 *  sees it past {@link resolveEventBotDifficulty}. */
export const storedDifficultyValidator = v.union(
    v.literal("easy"),
    difficultyValidator
);
export type StoredDifficulty = Infer<typeof storedDifficultyValidator>;

/** Stored (optional) difficulty resolved to a definite one. A row with no
 *  value (written before this field existed) or with the retired `easy` preset
 *  resolves to the lobby default (`expert`), like `resolveGamesFormat`. */
export function resolveEventBotDifficulty(event: {
    botDifficulty?: StoredDifficulty;
}): Difficulty {
    const stored = event.botDifficulty;
    return stored === undefined || stored === "easy"
        ? DEFAULT_EVENT_BOT_DIFFICULTY
        : stored;
}
