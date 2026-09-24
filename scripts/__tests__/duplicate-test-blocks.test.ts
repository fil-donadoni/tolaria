import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    collectTestBlocks,
    findDuplicateTestBlocks,
    type TestBlock,
} from "../lib/duplicate-test-blocks";

/**
 * Duplicate-test-block guard (issue #4620, after issue #4493).
 *
 * A duplicate test block is a project ANTIPATTERN: two `it` / `test` blocks
 * that run the same code against the same fixtures assert one behaviour
 * twice. The copy costs a run on every suite, doubles the edit when the
 * behaviour changes, and — the real damage — reads as independent evidence
 * when it is the same evidence counted twice. Issue #4493 deleted 20 of them
 * (PR #4618), most of them a set-side or caller-side copy of an engine test.
 *
 * The rule: **one behaviour, one block, in the module that owns it.** A card
 * test does not restate the engine test its mechanic already has; a caller
 * does not restate the gate its callee's suite already asserts. When the same
 * shape recurs with different INPUTS, that is a table — `it.each` — not a
 * copy.
 *
 * ── What it flags ────────────────────────────────────────────────────────────
 * Two or more test blocks, anywhere in the repo, with the same FINGERPRINT:
 *
 * 1. the body's token sequence — comments and whitespace do not count;
 * 2. every binding the body reads from OUTSIDE itself, resolved lexically
 *    (enclosing `describe` callbacks, loops, the module): an import is "this
 *    name from this module"; any other declaration contributes its own token
 *    text plus, recursively, the bindings IT reads.
 *
 * A `let` / `var` binding contributes its whole declaring scope instead of
 * its declaration, so a fixture seeded by `beforeEach` counts. A cycle between
 * helpers contributes the name of the helper that closes it.
 *
 * Part 2 is what makes the guard safe to red on. The same text reading a
 * different `describe`-local `setup()` / `gyState()` / `castKickedWith()` is
 * a different test — issue #4493 found 12 such look-alikes and kept them —
 * and here their fingerprints differ because their fixtures' text does.
 *
 * ── What it misses, by construction ──────────────────────────────────────────
 * It compares SYNTAX, so two blocks that reach the same value through
 * differently-spelled bindings (one imports `juggernaut`, the other builds
 * `getDefinition("<uuid>")` locally) are not recognised as one. The guard
 * trades that recall for zero false positives; review catches the rest.
 *
 * Runs in the application suite, so `health` (whose `test` step runs it)
 * enforces it on every batch — no PR-phase gate (issue #4481's norm).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — same set as the vacuous-alias guard. */
const SCAN_ROOTS = ["convex", "src", "scripts", "dashboard"];

/**
 * Test files exempted from the sweep, with the reason. FILE-scoped, like the
 * vacuous-alias guard next door: coarse on purpose, so every entry costs a
 * sentence. An entry belongs here only when running the same block in two
 * files IS the test.
 */
const ALLOWLIST = new Map<string, string>([
    [
        "scripts/__tests__/vitest-setup-freeze-once-b.test.ts",
        "the deliberate twin of vitest-setup-freeze-once.test.ts: the claim is " +
            "per WORKER, so two files asserting it is the test (issue #4484)",
    ],
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every test file in the repo — application and bot suites alike. */
function testFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.test\.tsx?$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f));
        }
    }
    return files.sort();
}

/** Every test block in the repo, parsed once per run (~15 s of AST work). */
let repoBlocks: TestBlock[] | undefined;
function scanRepo(exempt: ReadonlySet<string>): TestBlock[][] {
    repoBlocks ??= testFiles().flatMap((file) =>
        collectTestBlocks(
            file,
            fs.readFileSync(path.join(REPO_ROOT, file), "utf-8")
        )
    );
    return findDuplicateTestBlocks(
        repoBlocks.filter((b) => !exempt.has(b.file))
    );
}

/** Fixtures are ASSEMBLED, never written as literal test blocks, so the repo
 *  sweep never reads this guard's own fixtures as duplicates. */
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
    it("no two test blocks assert the same behaviour with the same bindings", () => {
        const groups = scanRepo(new Set(ALLOWLIST.keys()));
        const report = groups.map(
            (g) =>
                `${g.length} identical blocks — keep the one in the module that ` +
                `owns the behaviour, delete the others:\n` +
                g.map((b) => `    ${b.file}:${b.line} ${b.name}`).join("\n")
        );
        expect(report, report.join("\n")).toEqual([]);
        // Whole-corpus AST sweep, every test file: explicit, generous timeout
        // so a loaded machine never reads as a guard failure.
    }, 120_000);

    it("every allowlist entry has a reason and is still needed", () => {
        // Needed = lifting the exemption would red the sweep on that file.
        const flagged = new Set(
            scanRepo(new Set())
                .flat()
                .map((b) => b.file)
        );
        expect([...ALLOWLIST.keys()].filter((f) => !flagged.has(f))).toEqual(
            []
        );
        for (const reason of ALLOWLIST.values())
            expect(reason.length).toBeGreaterThan(0);
    }, 120_000);

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
});
