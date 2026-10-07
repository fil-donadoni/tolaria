import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Class guard for the `rmSync(tmp)` teardown race (issue #5169, RED tip
 * 9d4c59403): a test that spawns child processes (`child_process`) can still
 * have a detached descendant writing into its tmp tree — a gate lock's
 * `gate.waiters`, a log — when `afterEach` removes it, so a bare recursive
 * `rmSync` dies `ENOTEMPTY` and reds a test whose assertions all held.
 * `maxRetries` makes node re-walk the tree on ENOTEMPTY/EBUSY/EPERM.
 *
 * Every recursive delete (`rmSync`, `rm`, `rmdirSync`) in ANY tracked test
 * file that imports `child_process` therefore carries `maxRetries` in an
 * inline options literal. Fail-closed: an options object the scan cannot
 * read (a variable, a spread, a call) counts as bare. Pure text scan over
 * `git ls-files`: well under a second, runs with `scripts/__tests__` on
 * every diff.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function trackedTestFiles(): string[] {
    return execFileSync(
        "git",
        ["ls-files", "-z", "--", "*.test.ts", "*.test.tsx"],
        { cwd: REPO_ROOT, encoding: "utf8" }
    )
        .split("\0")
        .filter(Boolean);
}

/** The text between a call's opening paren and its matching close. */
function callArgs(source: string, open: number): string {
    let depth = 1;
    let i = open;
    for (; i < source.length && depth > 0; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") depth--;
    }
    return source.slice(open, i - 1);
}

/** Split top-level arguments on commas outside brackets. */
function topLevelArgs(args: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < args.length; i++) {
        const c = args[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 0) {
            out.push(args.slice(start, i));
            start = i + 1;
        }
    }
    out.push(args.slice(start));
    return out.map((a) => a.trim()).filter(Boolean);
}

/**
 * Lines of recursive deletes lacking `maxRetries`. A call whose options
 * argument is not an inline object literal is flagged: the scan cannot prove
 * it retries.
 */
export function bareRecursiveRmSyncs(source: string): number[] {
    const offenders: number[] = [];
    // `require("fs").rmSync(` is script text run BY the child (a deliberate
    // deletion under test), not this test's own teardown.
    const re = /(?<!require\("(?:node:)?fs"\)\.)\b(rmSync|rm|rmdirSync)\(/g;
    for (let m = re.exec(source); m; m = re.exec(source)) {
        const args = topLevelArgs(callArgs(source, m.index + m[0].length));
        if (args.length < 2) continue;
        const opts = args[1];
        const literal = opts.startsWith("{") && !/\.\.\./.test(opts);
        const bare = literal
            ? /recursive:\s*true/.test(opts) && !/maxRetries/.test(opts)
            : true;
        if (bare) offenders.push(source.slice(0, m.index).split("\n").length);
    }
    return offenders;
}

describe("test tmp teardown survives a live child (issue #5169)", () => {
    it("the scanner flags bare or opaque recursive deletes, accepts maxRetries", () => {
        const flagged = [
            `rmSync(tmp, { recursive: true, force: true });`,
            `fs.rm(tmp, { recursive: true }, cb);`,
            `rmdirSync(tmp, { recursive: true });`,
            `rmSync(tmp, OPTS);`,
            `rmSync(tmp, { ...OPTS });`,
            `getFs().rmSync(tmp, { recursive: true });`,
        ];
        for (const src of flagged)
            expect(bareRecursiveRmSyncs(src), src).toEqual([1]);
        const accepted = [
            `rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });`,
            `rmSync(file, { force: true });`,
            `rmSync(file);`,
            `require("fs").rmSync(gone, { recursive: true });`,
            `require("node:fs").rmSync(gone, { recursive: true });`,
        ];
        for (const src of accepted)
            expect(bareRecursiveRmSyncs(src), src).toEqual([]);
    });

    it("every recursive delete in a child-process test carries maxRetries", () => {
        const files = trackedTestFiles();
        // A scan over nothing passes vacuously.
        expect(files.length).toBeGreaterThan(500);
        const offenders = files.flatMap((file) => {
            const abs = path.join(REPO_ROOT, file);
            if (abs === __filename || !fs.existsSync(abs)) return [];
            const source = fs.readFileSync(abs, "utf8");
            if (!/child_process/.test(source)) return [];
            return bareRecursiveRmSyncs(source).map(
                (line) => `${file}:${line}`
            );
        });
        expect(
            offenders,
            "add `maxRetries: 10, retryDelay: 100` inline — a live child can still write into the tree"
        ).toEqual([]);
    });
});
