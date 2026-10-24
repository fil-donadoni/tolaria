// A stand-in for `lib/bot-reach-player.ts` in the shard tests (issue #6686):
// a verdict that is a pure function of the id, a play whose duration varies
// with it (so results ARRIVE out of order under several workers), and and a
// `throw-` id that throws past the player.
import type { BotPlayer } from "../../lib/oracle-bot-reach";

function weight(id: string): number {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
}

export async function createBotPlayer(): Promise<BotPlayer> {
    return (oracleId) => {
        if (oracleId.startsWith("throw-")) throw new Error("boom");
        const until = Date.now() + (weight(oracleId) % 7);
        while (Date.now() < until);
        return weight(oracleId) % 2 === 0
            ? { outcome: "played" }
            : { outcome: "ignored", cause: "no-progress", form: oracleId };
    };
}
