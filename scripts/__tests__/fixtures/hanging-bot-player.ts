// A player module whose Bot never finishes loading (issue #8718): no worker
// ever answers, so replacing them can never help and the pool must give up.
import type { BotPlayer } from "../../lib/oracle-bot-reach";

export function createBotPlayer(): Promise<BotPlayer> {
    return new Promise(() => {});
}
