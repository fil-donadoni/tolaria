import { describe, it, expect } from "vitest";
import {
    collectTestBlocks,
    duplicateTestBlockVerdict,
    findDuplicateTestBlocks,
} from "../lib/duplicate-test-blocks";

/**
 * The duplicate-test-block detector (issue #4620) on assembled fixtures. The
 * rule and the repo sweep live in `scripts/check-duplicate-test-blocks.ts`, a
 * batch-health step since issue #6098: as a test here it timed out under the
 * parallel `test:app` run.
 */

/** Fixtures are ASSEMBLED, never written as literal test blocks, so the repo
 *  sweep never reads this file's own fixtures as duplicates. */
const IT = "i" + "t";
function block(name: string, body: string[]): string {
    return [`${IT}("${name}", () => {`, ...body, "});"].join("\n");
}
const IMPORT = 'import { isAdminUser } from "../auth";';
const GATE = ["expect(isAdminUser(null)).toBe(false);"];

function dups(files: Record<string, string>): string[][] {
    const blocks = Object.entries(files).flatMap(([f, s]) =>
        collectTestBlocks(f, s)
    );
    return findDuplicateTestBlocks(blocks).map((g) =>
        g.map((b) => `${b.file}:${b.line}`)
    );
}

describe("duplicate test blocks (issue #4620)", () => {
    it("flags the same body reading the same import in two files", () => {
        expect(
            dups({
                "convex/__tests__/a.test.ts": [IMPORT, block("a", GATE)].join(
                    "\n"
                ),
                "convex/__tests__/b.test.ts": [IMPORT, block("b", GATE)].join(
                    "\n"
                ),
            })
        ).toEqual([
            ["convex/__tests__/a.test.ts:2", "convex/__tests__/b.test.ts:2"],
        ]);
    });

    it("flags a copy in the same file whose comments and layout differ", () => {
        const src = [
            IMPORT,
            block("a", GATE),
            block("b", [
                "// same claim, restated",
                "expect(",
                "  isAdminUser(null)",
                ").toBe(false);",
            ]),
        ].join("\n");
        expect(dups({ "convex/__tests__/a.test.ts": src })).toHaveLength(1);
    });

    it("flags identical bodies whose local fixtures are textually identical", () => {
        const file = [
            'import { makeState } from "../setup";',
            "function setup() { return makeState({ turn: 2 }); }",
            block("x", ["expect(setup().turn).toBe(2);"]),
        ].join("\n");
        expect(
            dups({
                "convex/__tests__/a.test.ts": file,
                "convex/__tests__/b.test.ts": file,
            })
        ).toHaveLength(1);
    });

    it("does NOT flag identical bodies reading different local fixtures", () => {
        const withSetup = (turn: number) =>
            [
                'import { makeState } from "../setup";',
                `function setup() { return makeState({ turn: ${turn} }); }`,
                block("x", ["expect(setup().stack).toHaveLength(0);"]),
            ].join("\n");
        expect(
            dups({
                "convex/__tests__/a.test.ts": withSetup(1),
                "convex/__tests__/b.test.ts": withSetup(2),
            })
        ).toEqual([]);
    });

    it("does NOT flag identical bodies whose `let` fixture beforeEach seeds differently", () => {
        const seeded = (value: number) =>
            [
                'describe("d", () => {',
                "    let current: number;",
                `    beforeEach(() => { current = ${value}; });`,
                block("x", ["expect(current).toBe(1);"]),
                "});",
            ].join("\n");
        expect(
            dups({
                "convex/__tests__/a.test.ts": seeded(1),
                "convex/__tests__/b.test.ts": seeded(2),
            })
        ).toEqual([]);
        expect(
            dups({
                "convex/__tests__/a.test.ts": seeded(1),
                "convex/__tests__/b.test.ts": seeded(1),
            })
        ).toHaveLength(1);
    });

    it("does NOT flag the same name imported from different modules", () => {
        expect(
            dups({
                "convex/__tests__/a.test.ts": [IMPORT, block("a", GATE)].join(
                    "\n"
                ),
                "convex/other/__tests__/b.test.ts": [
                    IMPORT,
                    block("b", GATE),
                ].join("\n"),
            })
        ).toEqual([]);
    });

    it("does NOT flag a table's rows, nor skipped blocks", () => {
        const src = [
            IMPORT,
            `${IT}.each([1, 2])("row %i", () => {`,
            ...GATE,
            "});",
            `${IT}.skip("a", () => {`,
            ...GATE,
            "});",
            block("b", GATE),
        ].join("\n");
        expect(dups({ "convex/__tests__/a.test.ts": src })).toEqual([]);
    });

    it("the verdict reports each group outside the allowlist, and a stale or reasonless entry", () => {
        const copy = [IMPORT, block("a", GATE)].join("\n");
        const blocks = [
            "convex/__tests__/a.test.ts",
            "convex/__tests__/b.test.ts",
            "convex/__tests__/c.test.ts",
        ].flatMap((f) => collectTestBlocks(f, copy));
        const clean = collectTestBlocks(
            "convex/__tests__/d.test.ts",
            block("d", ["expect(1).toBe(1);"])
        );

        const flagged = duplicateTestBlockVerdict(blocks, new Map());
        expect(flagged.ok).toBe(false);
        expect(flagged.findings).toEqual([
            "3 identical blocks — keep the one in the module that owns the behaviour, delete the others:\n" +
                '    convex/__tests__/a.test.ts:2 "a"\n' +
                '    convex/__tests__/b.test.ts:2 "a"\n' +
                '    convex/__tests__/c.test.ts:2 "a"',
        ]);

        // An exemption lifts its file's blocks; the rest still group.
        expect(
            duplicateTestBlockVerdict(
                blocks,
                new Map([["convex/__tests__/c.test.ts", "twin"]])
            ).findings
        ).toHaveLength(1);
        expect(
            duplicateTestBlockVerdict(
                blocks.slice(0, 2),
                new Map([["convex/__tests__/b.test.ts", "twin"]])
            )
        ).toEqual({ ok: true, findings: [] });

        expect(
            duplicateTestBlockVerdict(
                clean,
                new Map([["convex/__tests__/d.test.ts", "twin"]])
            ).findings
        ).toEqual([
            "allowlist entry convex/__tests__/d.test.ts is no longer needed — no block in it duplicates another; drop it from DUPLICATE_ALLOWLIST",
        ]);
        expect(
            duplicateTestBlockVerdict(
                blocks.slice(0, 2),
                new Map([["convex/__tests__/b.test.ts", ""]])
            ).findings
        ).toEqual([
            "allowlist entry convex/__tests__/b.test.ts carries no reason",
        ]);
    });
});
