import { describe, it, expect } from "vitest";
import {
    solveSmartAutoTap,
    AUTO_TAP_PLAN_CAP,
    type AutoTapSource,
} from "../autoTap";

/**
 * Wall-clock PERFORMANCE assertion for the smart auto-tap solver (ADR 0034).
 *
 * It lives in the `perf` vitest project (`bun run test:perf`, issue #3123) and
 * in NO gate. Its subject is `AUTO_TAP_PLAN_CAP`: the cap is what keeps a wide
 * board's plan enumeration from exploding combinatorially, and the only way to
 * observe "the cap actually bounds the work" rather than "the cap constant has
 * the value 512" is to time the call.
 *
 * That makes it a measurement of the MACHINE, which is exactly why it may not
 * run in the general suite. Health runs measured load average 21 on 8 cores;
 * at that contention a 1s ceiling reds correct code. Run it solo when you want
 * the number:
 *
 *     bun run test:perf
 *
 * The machine-independent half of this case — a valid 2-tap plan, and the cap
 * constant — stays in `autoTap.test.ts` and is gated normally.
 */

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** Choice source helper (one option per color). Mirrors autoTap.test.ts. */
function choice(cardId: string, colors: string[]): AutoTapSource {
    return {
        cardId,
        options: colors.map((c, i) => ({
            manaChoiceIndex: i,
            mana: { [c]: 1 } as never,
        })),
    };
}

describe("solveSmartAutoTap — plan-cap performance (ADR 0034)", () => {
    it("returns a plan for a 12-dual-source board in under a second", () => {
        // 12 dual sources, cost {2}: a combinatorial explosion of 2-tap plans.
        // Uncapped this does not finish; AUTO_TAP_PLAN_CAP bounds enumeration.
        const sources: AutoTapSource[] = [];
        for (let i = 0; i < 12; i++) {
            sources.push(choice(`d${i}`, ["U", "G"]));
        }
        const start = Date.now();
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 2 }, [], sources, []);
        const elapsed = Date.now() - start;
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
        expect(elapsed).toBeLessThan(1000);
        expect(AUTO_TAP_PLAN_CAP).toBe(512);
    });
});
