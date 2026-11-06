/**
 * A `must` entry that admits it is green by noise owes a baseline row (issue
 * #8459). The Ingest entry's note said "noise-settled" while it sat in `must`, and the next refit flipped its seed and held the whole queue.
 * The audit catches what no note admits, weekly; this catches the admission at
 * landing, for free.
 */
import { describe, expect, it } from "vitest";
import { confessesNoise } from "../robustness";
import { ROBUSTNESS_BASELINE } from "../robustnessBaseline";
import { bladeScenariosForTier } from "../registry";

describe("confessesNoise (issue #8459)", () => {
    it.each([
        "the two ties are noise-settled",
        "noise-pinned on this board",
        "Passes on 13/16 seeds at 400 iterations, not all",
        "passes 3/20 seeds",
    ])("reads an admission: %s", (note) => {
        expect(confessesNoise(note)).toBe(true);
    });

    it.each([
        undefined,
        "",
        "passes on 16/16 seeds",
        "the bot gave a land away on 1/5 seeds before the term",
        "rollout noise is not the lever here",
        "decided on mean reward",
    ])("reads no admission in: %s", (note) => {
        expect(confessesNoise(note)).toBe(false);
    });
});

describe("the must tier (issue #8459)", () => {
    it("holds no entry admitting noise without a baseline row", () => {
        const owned = new Set(ROBUSTNESS_BASELINE.map((r) => r.label));
        const orphans = bladeScenariosForTier("must")
            .filter((e) => confessesNoise(e.note) && !owned.has(e.label))
            .map((e) => e.label);
        expect(orphans).toEqual([]);
    });
});
