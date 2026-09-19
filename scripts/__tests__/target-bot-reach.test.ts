/**
 * Whole-Target Bot-play measurement (issue #4149) — the pure half: the
 * per-Target aggregation. The play itself is `playBotReach`, tested where it lives.
 */

import { describe, expect, it } from "vitest";
import { aggregate, type CardMeasure } from "../target-bot-reach";

describe("aggregate", () => {
    const card = (
        name: string,
        outcome: CardMeasure["outcome"],
        source?: CardMeasure["source"],
        gap?: string
    ): CardMeasure => ({
        name,
        oracleId: name,
        outcome,
        ...(source ? { source } : {}),
        ...(gap ? { gap } : {}),
    });

    it("splits counts by shipped source and ranks gaps by card count", () => {
        const m = aggregate("t", [
            card("A", "played", "hand-written"),
            card("B", "ignored", "hand-written", "never-chosen › x › draw"),
            card("C", "ignored", "compiled", "never-chosen › x › draw"),
            card("D", "frozen", "compiled", "no-progress › y"),
            card("E", "unplayable"),
        ]);
        expect(m.total).toBe(5);
        expect(m.counts.all).toEqual({ played: 1, ignored: 2, frozen: 1 });
        expect(m.counts["hand-written"]).toEqual({
            played: 1,
            ignored: 1,
            frozen: 0,
        });
        expect(m.counts.unplayable).toBe(1);
        expect(m.gaps.map((g) => [g.key, g.cards])).toEqual([
            ["never-chosen › x › draw", ["B", "C"]],
            ["no-progress › y", ["D"]],
        ]);
    });
});
