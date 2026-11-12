import { describe, it, expect } from "vitest";
import { brokenPredicateVerdict } from "../lib/health-step";

/**
 * A derive:sync predicate that gave no verdict while the machine slept is
 * INFRA (cause `sleep`), not a RED tip (issue #9292).
 */
const START = Date.parse("2026-11-12T11:30:47.000Z");
const WHY = "killed by SIGKILL";

describe("brokenPredicateVerdict — sleep during the derive:sync predicate (issue #9292)", () => {
    it("is infra/sleep when the machine slept after the predicate started", () => {
        const v = brokenPredicateVerdict({
            why: WHY,
            startedAt: START,
            lastSleepAt: START + 60_000,
        });
        expect(v.kind).toBe("infra");
        if (v.kind === "infra") expect(v.cause).toBe("sleep");
    });

    it("stays RED when no sleep is known", () => {
        expect(
            brokenPredicateVerdict({
                why: WHY,
                startedAt: START,
                lastSleepAt: null,
            }).kind
        ).toBe("red");
    });

    it("stays RED when the last sleep predates the predicate", () => {
        const v = brokenPredicateVerdict({
            why: WHY,
            startedAt: START,
            lastSleepAt: START - 1,
        });
        expect(v.kind).toBe("red");
        expect(v.reason).toContain(WHY);
    });
});
