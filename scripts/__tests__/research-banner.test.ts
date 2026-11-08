import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Every research note carries the date of its numbers (issue #8699).
 *
 * The owner's complaint (2026-11-07): readers meet decisions and measurements
 * with "old data and reasoning" and cannot tell. A number in `docs/research/`
 * is only true of the tree it was measured on, so each note opens, within its
 * first 20 lines, with `Measured at <sha> (<date>)` or `Dated:`. A note with
 * neither reads as current when it may be months stale.
 */

const RESEARCH_DIR = path.resolve(__dirname, "..", "..", "docs", "research");
const BANNER_WINDOW = 20;
const BANNER = /Measured at\b|\bDated:/;

const hasBanner = (text: string): boolean =>
    text
        .split("\n")
        .slice(0, BANNER_WINDOW)
        .some((l) => BANNER.test(l));

const notes = (): string[] =>
    fs
        .readdirSync(RESEARCH_DIR)
        .filter((f) => f.endsWith(".md"))
        .sort();

describe("docs/research/*.md carry a Measured-at / Dated banner", () => {
    it("finds a real corpus", () => {
        expect(notes().length).toBeGreaterThan(10);
    });

    it("every note has the banner within its first 20 lines", () => {
        const bare = notes().filter(
            (f) =>
                !hasBanner(fs.readFileSync(path.join(RESEARCH_DIR, f), "utf8"))
        );
        expect(
            bare,
            `docs/research note(s) with no \`Measured at <sha> (<date>)\` or \`Dated:\` line in the first ${BANNER_WINDOW}:\n${bare.join("\n")}`
        ).toEqual([]);
    });

    it("reds on a note with no banner, and on a banner past line 20", () => {
        expect(hasBanner("# Title\n\nSome numbers.\n")).toBe(false);
        const late =
            "# T\n" + "x\n".repeat(BANNER_WINDOW) + "> **Dated:** 2026-11-08\n";
        expect(hasBanner(late)).toBe(false);
        expect(
            hasBanner("# T\n\n> **Measured at `abc1234` (2026-11-08)**\n")
        ).toBe(true);
        expect(hasBanner("# T\n\n> **Dated:** 2026-11-08\n")).toBe(true);
    });
});
