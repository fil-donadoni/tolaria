/**
 * Blade LINES (ADR 0186 Decision 9) — `line.ts`. Each Line is played forward
 * through the live Brain request path, one consult per Bot decision, at its
 * declared iterations and seeds. `must` Lines gate; a `stretch` run reports
 * the others and never fails. `BLADE_VARIANT=<name>` runs them under a
 * search variant; a forced-guide arm binds each Line to it (`line.ts`).
 */

import { describe, expect, it } from "vitest";
import { lineEntryProblems, runBladeLine } from "../line";
import { BLADE_LINES } from "../lines";
import type { BladeLine } from "../types";
import { resolveBladeVariant } from "../variant";

const tier = process.env.BLADE_TIER ?? "must";
const variant = resolveBladeVariant(process.env.BLADE_VARIANT);

describe("blade lines", () => {
    for (const line of BLADE_LINES.filter((l) => l.tier === tier)) {
        it(line.label, () => {
            expect(lineEntryProblems(line)).toEqual([]);
            const result = runBladeLine(line, variant);
            if (tier === "stretch") {
                console.log(
                    `[stretch line] ${line.label}: ${result.ok ? "followed" : result.failureMessage} — cause: ${line.cause}`
                );
                return;
            }
            expect(result.failureMessage).toBe("");
            expect(result.ok).toBe(true);
        });
    }
});

describe.runIf(tier === "must")("a Line the Bot leaves", () => {
    it("names the decision, the expected move and the move chosen", () => {
        const base = BLADE_LINES[0];
        const wrong: BladeLine = {
            ...base,
            seeds: [base.seeds?.[0] ?? 0xb1ade],
            steps: base.steps.map((step, i) =>
                i === 1 ? { ...step, expect: [{ kind: "pass" }] } : step
            ),
        };
        const result = runBladeLine(wrong);
        expect(result.ok).toBe(false);
        expect(result.seeds[0].failedAt).toBe(1);
        expect(result.failureMessage).toMatch(
            /decision 2: expected \[pass\], chose \[.*Giant Growth.*\]/
        );
    });
});
