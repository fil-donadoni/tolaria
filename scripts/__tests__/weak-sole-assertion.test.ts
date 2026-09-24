import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Weak-sole-assertion lint — a WARNING, never a red (issue #4492).
 *
 * The vacuous-assertion family next door (`vacuous-alias-assertion.test.ts`)
 * reds on a shape that is true by construction. This one reports a shape that
 * is merely WEAK: a test block whose every assertion is one that almost any
 * outcome satisfies.
 *
 * ── What it counts ───────────────────────────────────────────────────────────
 * A test block (`it` / `test`, any modifier but `skip` / `todo`) whose direct
 * `expect(…)` assertions are ALL of one weak kind:
 *
 * - `defined-only` — every matcher is `toBeDefined()` / `toBeTruthy()`, and no
 *   asserted value is a throwing Testing Library query (`getBy*`, `getAllBy*`,
 *   `findBy*`, `findAllBy*`). With a throwing query the query IS the
 *   assertion, so `expect(getByText("x")).toBeTruthy()` is not weak.
 * - `not-throw-only` — every matcher is `.not.toThrow()` /
 *   `.not.toThrowError()`: the block proves the code ran, nothing about what
 *   it did.
 *
 * A block with no direct `expect` at all is out of scope here: it either
 * asserts through a helper, or `expect.requireAssertions` (on for every
 * project, `vitest.config.ts`) already reds it.
 *
 * ── Why a warning ────────────────────────────────────────────────────────────
 * Some of these blocks are exactly right (a smoke test whose claim IS "does
 * not throw"), and the syntax cannot tell which. The report steers a NEW test
 * toward a real assertion without demanding a purge of the old ones: the
 * repo-wide sweep writes its counts to stderr and asserts only that it swept
 * something. `process.stderr.write`, not `console.warn`: vitest 4.1's agent
 * reporter drops the console output of a passing test, and a warning nobody
 * sees is no warning.
 *
 * Baseline when shipped (issue #4492): the sweep printed 100 `defined-only`
 * and 76 `not-throw-only`. The issue's survey counted 114 / 46 with a
 * definition it does not record; the numbers here are this lint's, and the
 * sweep's output is the current figure.
 *
 * Runs in the application suite, so `health` (whose `test` step runs it)
 * reports it on every batch.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — same set as the vacuous-alias guard. */
const SCAN_ROOTS = ["convex", "src", "scripts", "dashboard"];

const TEST_BLOCK_CALLEES = new Set(["it", "test"]);
const SKIPPED_MODIFIERS = new Set(["skip", "todo"]);
const DEFINED_MATCHERS = new Set(["toBeDefined", "toBeTruthy"]);
const THROW_MATCHERS = new Set(["toThrow", "toThrowError"]);
/** Testing Library's throwing queries, by their full names — a bare
 *  `(get|find)By…` prefix would also clear engine helpers such as
 *  `findByName` / `findByDefId`, which return undefined instead. */
const THROWING_QUERY =
    /^(get|find)(All)?By(Role|Text|LabelText|PlaceholderText|AltText|Title|DisplayValue|TestId)$/;

type WeakKind = "defined-only" | "not-throw-only";

interface WeakBlock {
    file: string;
    line: number;
    kind: WeakKind;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        // A symlink is neither walked nor read: one named `*.test.ts` that
        // points at a directory would throw EISDIR and red a warning-only lint.
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

function testFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.(test|spec)\.tsx?$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f));
        }
    }
    return files;
}

/** `it.only.each(…)` → `it`, plus whether a skipping modifier is present. */
function testBlockCallee(
    callee: ts.Expression
): { name: string; skipped: boolean } | undefined {
    let node: ts.Expression = callee;
    let skipped = false;
    for (;;) {
        if (ts.isCallExpression(node)) node = node.expression;
        else if (ts.isPropertyAccessExpression(node)) {
            if (SKIPPED_MODIFIERS.has(node.name.text)) skipped = true;
            node = node.expression;
        } else break;
    }
    return ts.isIdentifier(node) ? { name: node.text, skipped } : undefined;
}

interface Assertion {
    matcher: string;
    negated: boolean;
    subject: ts.Expression | undefined;
}

/**
 * Reads `expect(x)[.not][.resolves|.rejects].matcher(…)` off a call, or
 * undefined when the call is not an assertion rooted at `expect(…)`.
 */
function readAssertion(call: ts.CallExpression): Assertion | undefined {
    if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
    const matcher = call.expression.name.text;
    let node: ts.Expression = call.expression.expression;
    let negated = false;
    while (ts.isPropertyAccessExpression(node)) {
        if (node.name.text === "not") negated = true;
        node = node.expression;
    }
    if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== "expect"
    ) {
        return undefined;
    }
    return { matcher, negated, subject: node.arguments[0] };
}

function callsThrowingQuery(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(n)) {
            const callee = n.expression;
            const name = ts.isIdentifier(callee)
                ? callee.text
                : ts.isPropertyAccessExpression(callee)
                  ? callee.name.text
                  : "";
            if (THROWING_QUERY.test(name)) {
                found = true;
                return;
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

function assertionsIn(body: ts.Node): Assertion[] {
    const out: Assertion[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
            const a = readAssertion(n);
            if (a) {
                out.push(a);
                return;
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(body);
    return out;
}

function classify(assertions: Assertion[]): WeakKind | undefined {
    if (assertions.length === 0) return undefined;
    const definedOnly = assertions.every(
        (a) =>
            !a.negated &&
            DEFINED_MATCHERS.has(a.matcher) &&
            !(a.subject && callsThrowingQuery(a.subject))
    );
    if (definedOnly) return "defined-only";
    const notThrowOnly = assertions.every(
        (a) => a.negated && THROW_MATCHERS.has(a.matcher)
    );
    if (notThrowOnly) return "not-throw-only";
    return undefined;
}

function findWeakBlocks(file: string, source: string): WeakBlock[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const out: WeakBlock[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
            const callee = testBlockCallee(n.expression);
            const body = n.arguments.find(
                (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)
            );
            if (
                callee &&
                TEST_BLOCK_CALLEES.has(callee.name) &&
                !callee.skipped &&
                body
            ) {
                const kind = classify(assertionsIn(body));
                if (kind) {
                    out.push({
                        file,
                        line:
                            sf.getLineAndCharacterOfPosition(n.getStart(sf))
                                .line + 1,
                        kind,
                    });
                }
                return;
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

function fixture(body: string[]): string {
    return [
        'it("synthetic", () => {',
        ...body.map((l) => `    ${l}`),
        "});",
    ].join("\n");
}

describe("weak sole assertions (warning only, issue #4492)", () => {
    it("reports the repo's weak blocks by kind, without failing on them", () => {
        const files = testFiles();
        const found = files.flatMap((f) =>
            findWeakBlocks(f, fs.readFileSync(path.join(REPO_ROOT, f), "utf-8"))
        );
        const count = (kind: WeakKind) =>
            found.filter((b) => b.kind === kind).length;
        process.stderr.write(
            `weak-sole-assertion: ${count("defined-only")} defined-only, ` +
                `${count("not-throw-only")} not-throw-only ` +
                `(over ${files.length} test files) — warning only; a NEW ` +
                `test should assert what the code did, not that it ran.\n`
        );
        // The one hard claim: the sweep saw the corpus. Zero files means a
        // moved root, and a lint that reads nothing reports a clean zero.
        expect(files.length).toBeGreaterThan(100);
    }, 120_000);

    it("flags a block whose only matcher is toBeDefined / toBeTruthy", () => {
        const bad = fixture([
            "const r = run();",
            "expect(r).toBeDefined();",
            "expect(r.value).toBeTruthy();",
        ]);
        expect(findWeakBlocks("bad.test.ts", bad)).toEqual([
            { file: "bad.test.ts", line: 1, kind: "defined-only" },
        ]);
    });

    it("flags a block whose only matcher is not.toThrow", () => {
        const bad = fixture([
            "expect(() => run()).not.toThrow();",
            'expect(() => run(1)).not.toThrowError("x");',
        ]);
        expect(findWeakBlocks("bad.test.ts", bad)).toEqual([
            { file: "bad.test.ts", line: 1, kind: "not-throw-only" },
        ]);
    });

    it("clears a block with a real assertion, a throwing query, or a skip", () => {
        const mixed = fixture([
            "expect(r).toBeDefined();",
            "expect(r.value).toBe(3);",
        ]);
        const query = fixture([
            'expect(screen.getByText("x")).toBeTruthy();',
            'expect(await findByRole("button")).toBeDefined();',
        ]);
        const positiveThrow = fixture(["expect(() => run()).toThrow();"]);
        const skipped = [
            'it.skip("s", () => { expect(r).toBeDefined(); });',
            'it.todo("t");',
        ].join("\n");
        const helperOnly = fixture(["assertRan(run());"]);
        for (const src of [mixed, query, positiveThrow, skipped, helperOnly]) {
            expect(findWeakBlocks("ok.test.ts", src), src).toEqual([]);
        }
    });

    it("reads it.each / test.only and nested describes", () => {
        const src = [
            'describe("d", () => {',
            '    it.each([1, 2])("e %i", (n) => { expect(n).toBeTruthy(); });',
            '    test.only("o", () => { expect(() => f()).not.toThrow(); });',
            "});",
        ].join("\n");
        expect(
            findWeakBlocks("n.test.ts", src).map((b) => [b.line, b.kind])
        ).toEqual([
            [2, "defined-only"],
            [3, "not-throw-only"],
        ]);
    });
});
