import { describe, it, expect } from "vitest";
import {
    TONES,
    toneBadgeClass,
    toneFillClass,
    toneRuleClass,
    toneTextClass,
    type Tone,
} from "../tones";

/**
 * The tone table (PRD #3148 S1) — ONE table, so a tone is named once.
 *
 * The assertion that matters is not "good is green": it is that `unknown` is
 * its OWN tone and not a second spelling of `bad`. "I could not tell" is not
 * "this is wrong", and collapsing them is the confusion #2630 exists to kill —
 * a refactor that mapped both onto `destructive` because shadcn has no
 * `unknown` variant would be exactly that regression, and it would look tidy.
 */

const ACCESSORS = [
    toneBadgeClass,
    toneTextClass,
    toneFillClass,
    toneRuleClass,
] as const;

describe("tones — five roles, each named once", () => {
    it.each(TONES)("%s resolves through every accessor", (tone) => {
        for (const accessor of ACCESSORS) {
            expect(accessor(tone as Tone)).toBeTruthy();
        }
    });

    it("unknown is its own tone, never a second name for bad", () => {
        expect(toneTextClass("unknown")).not.toBe(toneTextClass("bad"));
        expect(toneFillClass("unknown")).not.toBe(toneFillClass("bad"));
        expect(toneBadgeClass("unknown")).not.toBe(toneBadgeClass("bad"));
    });

    it("no two tones share a colour — a table where two roles collide is a table that names one of them for nothing", () => {
        const seen = new Set(TONES.map((t) => toneTextClass(t as Tone)));
        expect(seen.size).toBe(TONES.length);
    });
});

describe("tones — confidence is a modifier, not a sixth tone", () => {
    it("`inferred` dashes the edge and keeps the tone's colour", () => {
        const certain = toneBadgeClass("good");
        const inferred = toneBadgeClass("good", "inferred");
        expect(inferred).toContain(certain);
        expect(inferred).toContain("border-dashed");
        expect(certain).not.toContain("border-dashed");
    });

    it("dashes every tone the same way — confidence and verdict are different axes", () => {
        for (const tone of TONES) {
            expect(toneBadgeClass(tone as Tone, "inferred")).toContain(
                "border-dashed"
            );
        }
    });
});
