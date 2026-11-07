// A stand-in for `lib/bot-reach-player.ts` whose workers DIE (issue #8718),
// keyed by the card's id:
//   `…-stall` wedges the first worker that meets it and plays for the next one
//             — a machine under load: the card is innocent, the batch times out
//   `wedge-…` wedges every worker that meets it — a card that really hangs
// `SHARD_MARKS` is a directory the workers share: threads have no other memory
// in common, and the second attempt has to know it is the second.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BotPlayer } from "../../lib/oracle-bot-reach";

function firstMeeting(id: string): boolean {
    try {
        mkdirSync(join(process.env.SHARD_MARKS as string, id));
        return true;
    } catch {
        return false;
    }
}

export async function createBotPlayer(): Promise<BotPlayer> {
    return (oracleId) => {
        if (
            oracleId.startsWith("wedge-") ||
            (oracleId.endsWith("-stall") && firstMeeting(oracleId))
        )
            for (;;);
        return { outcome: "played" };
    };
}
