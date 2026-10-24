/**
 * The Bot-play player (ADR 0105 § 7.2), shared by the in-process sweep
 * (`oracle-compile.ts`) and the sweep's worker threads
 * (`bot-reach-worker.ts`, issue #6686).
 *
 * The Bot is imported HERE, dynamically, and nowhere else on the compile
 * path: `buildLockfile` is also the drift guard's regenerator
 * (`check-oracle-lockfile.ts`, inside `check:pr` / `land`), and a static
 * import would put the whole search in the gate's module graph for a path
 * that must never play.
 */
import type { CardDefinition } from "../../convex/cards/types";
import type { BotReachVerdict } from "../../convex/gre/ai/botReach";
import type { BotPlayer } from "./oracle-bot-reach";

/** The verdict a card that threw while played is shipped with. */
export function harnessErrorVerdict(error: unknown): BotReachVerdict {
    return {
        outcome: "ignored",
        cause: "harness-error",
        form:
            error instanceof Error
                ? error.message.slice(0, 120)
                : String(error).slice(0, 120),
    };
}

export async function createBotPlayer(): Promise<BotPlayer> {
    const { playBotReach } = await import("../../convex/gre/ai/botReach");
    const { preloadDefinitions } = await import("../../convex/cards/registry");
    return (oracleId, definition) => {
        // A compiled definition is not a catalogue card: registered by id
        // for the play, through the batch seam so an inset or split
        // card's twins are registered with it.
        const def = {
            ...definition,
            id: `oracle-bot-reach:${oracleId}`,
            rarity: "common",
        } as CardDefinition;
        preloadDefinitions([def]);
        try {
            return playBotReach(def);
        } catch (error) {
            // A throw here is the SWEEP failing, never the card: without
            // this catch it unwinds through `buildLockfile` to `main`,
            // nothing is written, and the whole 21-minute run is lost
            // with every verdict it had already earned (review of
            // PR #4057, finding 7). Ship the card, rank the shape.
            return harnessErrorVerdict(error);
        }
    };
}
