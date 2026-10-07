import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Class guard for the `rmSync(tmp)` teardown race (issue #5168, RED tip
 * 9d4c59403): a test that spawns child processes (`child_process`) can still
 * have a detached descendant writing into its tmp tree — a gate lock's
 * `gate.waiters`, a log — when `afterEach` removes it, so a bare recursive
 * `rmSync` dies `ENOTEMPTY` and reds a test whose assertions all held.
 * `maxRetries` makes node re-walk the tree on ENOTEMPTY/EBUSY/EPERM.
 *
 * Every recursive `rmSync` in a `scripts/` test that imports `child_process`
 * therefore carries `maxRetries`. Pure text scan: milliseconds, runs with the
 * rest of `scripts/__tests__` on every diff.
 */

const TESTS_DIR = __dirname;
const SCRIPTS_ROOT = path.resolve(TESTS_DIR, "..");

function testFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory())
            return e.name === "node_modules" ? [] : testFiles(p);
        return /\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
}

/** Recursive `rmSync(…, { recursive: true … })` calls lacking `maxRetries`. */
export function bareRecursiveRmSyncs(source: string): number[] {
    const offenders: number[] = [];
    const re = /rmSync\(/g;
    for (let m = re.exec(source); m; m = re.exec(source)) {
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
        }
        const call = source.slice(m.index, i);
        if (/recursive:\s*true/.test(call) && !/maxRetries/.test(call))
            offenders.push(source.slice(0, m.index).split("\n").length);
    }
    return offenders;
}

describe("test tmp teardown survives a live child (issue #5168)", () => {
    it("the scanner flags a bare recursive rmSync and accepts maxRetries", () => {
        const bare = `rmSync(tmp, { recursive: true, force: true });`;
        const ok = `rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });`;
        expect(bareRecursiveRmSyncs(bare)).toEqual([1]);
        expect(bareRecursiveRmSyncs(ok)).toEqual([]);
        expect(bareRecursiveRmSyncs(`rmSync(file, { force: true });`)).toEqual(
            []
        );
    });

    it("every recursive rmSync in a child-process test carries maxRetries", () => {
        const offenders = testFiles(SCRIPTS_ROOT).flatMap((file) => {
            if (file === __filename) return [];
            const source = fs.readFileSync(file, "utf8");
            if (!/child_process/.test(source)) return [];
            return bareRecursiveRmSyncs(source).map(
                (line) => `${path.relative(SCRIPTS_ROOT, file)}:${line}`
            );
        });
        expect(
            offenders,
            "add `maxRetries: 10, retryDelay: 100` — a live child can still write into the tree"
        ).toEqual([]);
    });
});
