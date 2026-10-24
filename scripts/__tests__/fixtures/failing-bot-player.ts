// A player module that cannot load its Bot (issue #6686): every worker's
// `createBotPlayer` rejects, so every batch must come back `harness-error`.
import type { BotPlayer } from "../../lib/oracle-bot-reach";

export async function createBotPlayer(): Promise<BotPlayer> {
    throw new Error("cannot load the Bot");
}
