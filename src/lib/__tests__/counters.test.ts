import { describe, it, expect } from "vitest";
import { getCounterDisplays, isPTCounter } from "../counters";
import type { CardInstance } from "~/types/game";

function makeCard(counters?: Record<string, number>): CardInstance {
    return {
        id: "c1",
        card: { id: "x" },
        ownerId: "p1",
        controllerId: "p1",
        zone: "battlefield",
        counters,
    } as unknown as CardInstance;
}

describe("counters display (CR 122)", () => {
    it("isPTCounter matches P/T-modifying keys only", () => {
        expect(isPTCounter("+1/+1")).toBe(true);
        expect(isPTCounter("-1/-1")).toBe(true);
        expect(isPTCounter("+0/+1")).toBe(true);
        expect(isPTCounter("wind")).toBe(false);
        expect(isPTCounter("gaea-forest")).toBe(false);
    });

    it("returns empty when no counters", () => {
        expect(getCounterDisplays(makeCard())).toEqual([]);
        expect(getCounterDisplays(makeCard({}))).toEqual([]);
    });

    it("drops zero/negative counts", () => {
        const out = getCounterDisplays(makeCard({ "+1/+1": 0, wind: 3 }));
        expect(out.map((c) => c.type)).toEqual(["wind"]);
    });

    it("formats P/T and named counters with label/short/tone", () => {
        const out = getCounterDisplays(
            makeCard({ "+1/+1": 2, "gaea-forest": 1 })
        );
        // P/T counters sort before named.
        expect(out[0]).toMatchObject({
            type: "+1/+1",
            count: 2,
            label: "+1/+1",
            short: "+1/+1",
            tone: "buff",
        });
        expect(out[1]).toMatchObject({
            type: "gaea-forest",
            label: "Gaea Forest",
            short: "GF",
            tone: "neutral",
        });
    });

    it("tones a fully-negative P/T counter as debuff", () => {
        const [c] = getCounterDisplays(makeCard({ "-1/-1": 1 }));
        expect(c.tone).toBe("debuff");
    });

    it("single-word named counter shortens to ≤3 chars upper", () => {
        const [c] = getCounterDisplays(makeCard({ wind: 1 }));
        expect(c.short).toBe("WIN");
        expect(c.label).toBe("Wind");
    });
});

// `imprint-<color>` is the machine-readable colour store Chrome Mox's mana
// ability reads (CR 605.1a) — not a CR 122 counter. Rendering it produced an
// unexplained "I*" chip on the card while the actual imprint (the exiled card,
// pinned to the permanent) told the whole story.
describe("getCounterDisplays hides internal bookkeeping counters", () => {
    it("drops imprint-<color> entries", () => {
        const out = getCounterDisplays(
            makeCard({ "imprint-G": 1, "imprint-U": 1 })
        );
        expect(out).toEqual([]);
    });

    it("still shows real counters alongside an imprint", () => {
        const out = getCounterDisplays(makeCard({ "imprint-R": 1, charge: 2 }));
        expect(out.map((c) => c.type)).toEqual(["charge"]);
    });
});
