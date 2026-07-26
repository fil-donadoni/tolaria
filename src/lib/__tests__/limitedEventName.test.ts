// Limited Event display name: the wire's machine shape (`type` + one
// `packSlots` entry PER BOOSTER) rendered literally produced
// "draft — VINTAGE-CUBE, VINTAGE-CUBE, VINTAGE-CUBE". These assert the
// collapse to a name a player recognizes.
import { describe, it, expect } from "vitest";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { limitedEventName, packSourceName } from "../limitedEventName";

function event(
    type: LimitedEventView["type"],
    packSlots: string[]
): Pick<LimitedEventView, "type" | "packSlots"> {
    return { type, packSlots } as Pick<LimitedEventView, "type" | "packSlots">;
}

describe("limitedEventName", () => {
    it("collapses a 3-booster cube draft to 'Vintage Cube Draft'", () => {
        expect(
            limitedEventName(
                event("draft", ["vintage-cube", "vintage-cube", "vintage-cube"])
            )
        ).toBe("Vintage Cube Draft");
    });

    it("names a set draft by the set's full name, not its code", () => {
        expect(limitedEventName(event("draft", ["lea", "lea", "lea"]))).toBe(
            "Limited Edition Alpha Draft"
        );
    });

    it("names a Sealed event by its single pack source", () => {
        expect(limitedEventName(event("sealed", ["ice"]))).toBe(
            "Ice Age Sealed"
        );
    });

    it("keeps every DISTINCT source, in order, for a multi-set block draft", () => {
        expect(limitedEventName(event("draft", ["ice", "drk", "lea"]))).toBe(
            "Ice Age / The Dark / Limited Edition Alpha Draft"
        );
    });

    it("falls back to the upper-cased code for a set with no registered name", () => {
        expect(limitedEventName(event("draft", ["zzz", "zzz"]))).toBe(
            "ZZZ Draft"
        );
    });

    it("degrades to the bare type when there is no pack source at all", () => {
        expect(limitedEventName(event("sealed", []))).toBe("Sealed");
    });
});

describe("packSourceName", () => {
    it("labels the cube source (case-insensitively)", () => {
        expect(packSourceName("vintage-cube")).toBe("Vintage Cube");
        expect(packSourceName("VINTAGE-CUBE")).toBe("Vintage Cube");
    });

    it("labels a real set by name", () => {
        expect(packSourceName("drk")).toBe("The Dark");
    });
});
