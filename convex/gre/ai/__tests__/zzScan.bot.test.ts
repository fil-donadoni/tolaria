import { it, expect } from "vitest";
import { appendFileSync } from "node:fs";
import { getCardByName } from "../../../cards";
import { playBotReachSeats, playBotReach, BOT_REACH_BUDGET } from "../botReach";

it("scan echoes", () => {
    const def = getCardByName("Haunting Echoes")!;
    let n = 0;
    const row: string[] = [];
    for (let s = 1; s <= 20; s++) {
        const seats = playBotReachSeats(def, { iterations: 48, seeds: [s] });
        const o = seats.map((x) => (x.verdict.outcome === "played" ? 1 : 0));
        n += o[0] + o[1];
        row.push(`${s}:${o.join("")}`);
    }
    const dflt = playBotReach(def, BOT_REACH_BUDGET).outcome;
    appendFileSync(
        process.env.OUT!,
        `\n${process.env.TAG} played-seat-seeds=${n}/40 ${row.join(" ")} default=${dflt}\n`
    );
    expect(1).toBe(1);
});
