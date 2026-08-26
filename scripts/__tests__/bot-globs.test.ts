import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { BOT_GLOBS, matchesBotGlob, touchesBotGlobs } from "../lib/bot-globs";

/**
 * `BOT_GLOBS` is the ONE shared list issue #2688 requires — a copy in
 * `.claude/rules/bot-development.md`'s frontmatter and another baked into
 * the receipt validator was explicitly called out as the drift risk. This
 * file is what keeps the markdown copy honest: it parses the frontmatter's
 * `globs:` list and asserts it is byte-identical to the exported array,
 * rather than trusting two authors to keep them in sync by hand.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULE_FILE = path.join(
    REPO_ROOT,
    ".claude",
    "rules",
    "bot-development.md"
);

function parseFrontmatterGlobs(markdown: string): string[] {
    const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
    if (!match) throw new Error("no frontmatter block found");
    const frontmatter = match[1];
    const globsBlock = /globs:\n((?:\s+- .+\n?)+)/.exec(frontmatter);
    if (!globsBlock) throw new Error("no `globs:` list found in frontmatter");
    return globsBlock[1]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) =>
            line
                .slice(2)
                .trim()
                .replace(/^"(.*)"$/, "$1")
        );
}

describe("BOT_GLOBS is the single source the rule file's frontmatter mirrors", () => {
    it("bot-development.md's globs match BOT_GLOBS exactly", () => {
        const markdown = fs.readFileSync(RULE_FILE, "utf8");
        expect(parseFrontmatterGlobs(markdown)).toEqual(BOT_GLOBS);
    });
});

describe("matchesBotGlob / touchesBotGlobs", () => {
    const cases: Array<{ path: string; expected: boolean }> = [
        { path: "convex/gre/search.ts", expected: true },
        { path: "convex/gre/evaluate.ts", expected: true },
        { path: "convex/gre/shouldThink.ts", expected: true },
        { path: "convex/gre/ai/beneficence.ts", expected: true },
        { path: "convex/gre/ai/blade/damnation.ts", expected: true },
        { path: "src/lib/ai/executor.ts", expected: true },
        { path: "src/lib/ai/selfplay/ladder.ts", expected: true },
        // A file that merely sits near the Bot but isn't a listed module —
        // the brace-alternation is exact-name, not prefix.
        { path: "convex/gre/searchHelpers.ts", expected: false },
        { path: "convex/gre/state.ts", expected: false },
        { path: "convex/cards/sets/lea/red.ts", expected: false },
        { path: "src/lib/card-utils.ts", expected: false },
        { path: "scripts/lib/receipt.ts", expected: false },
    ];

    for (const { path: p, expected } of cases) {
        it(`${p} → ${expected}`, () => {
            expect(matchesBotGlob(p)).toBe(expected);
        });
    }

    it("touchesBotGlobs is true when ANY target file matches", () => {
        expect(
            touchesBotGlobs(["scripts/lib/receipt.ts", "convex/gre/ai/x.ts"])
        ).toBe(true);
        expect(touchesBotGlobs(["scripts/lib/receipt.ts", "CLAUDE.md"])).toBe(
            false
        );
        expect(touchesBotGlobs([])).toBe(false);
    });
});
