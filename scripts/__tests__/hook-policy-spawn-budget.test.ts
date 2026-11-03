import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

/**
 * Guard: no `it` in the hook-policy suite spawns a hook inside a loop
 * (issue #7859).
 *
 * `hook-policy.test.ts` runs the real `deny-guard.sh` through `runHook` — one
 * `spawnSync` per call, ~195 ms standalone and ~6.5x that under batch health —
 * beneath a fixed 30 s `testTimeout`. A test that loops `runHook` over a list
 * has a budget that does not grow with its case count, so it crossed 30 s on
 * any load spike (`Test timed out in 30000ms`, two REDs on 2026-11-02). A
 * table-driven test (`it.each`) gives each spawn its own budget.
 *
 * The check is a syntax walk, not a regex: a loop construct (`for`, `while`,
 * `forEach`/`map`/…) that contains a spawning call, inside the callback of an
 * `it`/`test` — or of the callback an `it.each(...)(...)` returns.
 */

const SUITE = path.resolve(__dirname, "hook-policy.test.ts");

/** Calls that start a child process in the suite (`runHook` wraps `spawnSync`). */
const SPAWNING_CALLS = new Set([
    "runHook",
    "runJoinerAsHookWould",
    "spawnSync",
    "execFileSync",
]);

const ARRAY_ITERATORS = new Set([
    "forEach",
    "map",
    "flatMap",
    "filter",
    "some",
    "every",
    "reduce",
]);

type SpawnLoop = { line: number; test: string };

function isTestCall(call: ts.CallExpression): boolean {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) {
        return callee.text === "it" || callee.text === "test";
    }
    // `it.each(table)(title, fn)`: the callee is itself a call to `.each`.
    if (ts.isCallExpression(callee)) {
        const inner = callee.expression;
        return (
            ts.isPropertyAccessExpression(inner) &&
            inner.name.text === "each" &&
            ts.isIdentifier(inner.expression) &&
            (inner.expression.text === "it" || inner.expression.text === "test")
        );
    }
    return false;
}

function spawns(node: ts.Node): boolean {
    let found = false;
    const walk = (n: ts.Node): void => {
        if (found) return;
        if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            SPAWNING_CALLS.has(n.expression.text)
        ) {
            found = true;
            return;
        }
        ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
}

function isLoop(n: ts.Node): boolean {
    if (
        ts.isForStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n)
    ) {
        return true;
    }
    return (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ARRAY_ITERATORS.has(n.expression.name.text)
    );
}

/** Every loop that spawns a process, inside a single test case's callback. */
function findSpawnLoops(source: string): SpawnLoop[] {
    const sf = ts.createSourceFile(
        "hook-policy.test.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const out: SpawnLoop[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && isTestCall(n)) {
            const [title, fn] = n.arguments;
            if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
                const inspect = (m: ts.Node): void => {
                    if (isLoop(m) && spawns(m)) {
                        out.push({
                            line:
                                sf.getLineAndCharacterOfPosition(m.getStart())
                                    .line + 1,
                            test:
                                title && ts.isStringLiteralLike(title)
                                    ? title.text
                                    : "(computed title)",
                        });
                        return; // report the outermost loop once
                    }
                    ts.forEachChild(m, inspect);
                };
                inspect(fn.body);
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

describe("hook-policy suite — one spawn per test budget (issue #7859)", () => {
    it("no `it` loops a hook spawn over a list; each case is an `it.each` row", () => {
        const loops = findSpawnLoops(fs.readFileSync(SUITE, "utf8"));
        expect(
            loops,
            `hook-policy.test.ts: a loop spawns the hook inside ONE test, so its ` +
                `30 s budget does not grow with the list. Make the list an ` +
                `\`it.each\` table:\n` +
                loops.map((l) => `  line ${l.line}: ${l.test}`).join("\n")
        ).toEqual([]);
    });

    // The negative control: the walk must actually see the shape it forbids,
    // or the test above is green for the wrong reason.
    it("flags a runHook loop inside one `it`", () => {
        const bad = `
            it("loops", () => {
                for (const cmd of ["a", "b"]) {
                    runHook(DENY_GUARD, bash(cmd, wt));
                }
            });`;
        expect(findSpawnLoops(bad)).toEqual([{ line: 3, test: "loops" }]);
    });

    it("flags an array-iterator loop and a loop inside an `it.each` case", () => {
        const bad = `
            it("iterates", () => {
                ["a", "b"].forEach((cmd) => runHook(DENY_GUARD, bash(cmd, wt)));
            });
            it.each(["x"])("each", (x) => {
                while (x) { spawnSync("sh", []); }
            });`;
        expect(findSpawnLoops(bad).map((l) => l.test)).toEqual([
            "iterates",
            "each",
        ]);
    });

    it("allows a table-driven case and a loop that spawns nothing", () => {
        const good = `
            it.each(["a", "b"])("table %s", (cmd) => {
                runHook(DENY_GUARD, bash(cmd, wt));
            });
            it("pure loop", () => {
                for (const s of scripts) { expect(s).toBeDefined(); }
            });`;
        expect(findSpawnLoops(good)).toEqual([]);
    });
});
