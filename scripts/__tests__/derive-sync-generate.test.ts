/**
 * `derive:sync`'s generators under their wall (issue #8693): `bot:refit` ran
 * past its 600 s and only the direct child died — its vitest went on,
 * reparented to pid 1, recording pins into a tree the run had already put back
 * to HEAD and was about to commit from.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generate } from "../derive-sync";

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe("generate — a generator's wall takes its whole tree (issue #8693)", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-generate-"));
    });
    afterEach(() => {
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    });

    it("no process of a generator outlives its wall, so nothing writes after the run moved on", () => {
        const pidFile = join(dir, "grandchild");
        // The shape of `bot:refit`: a bun parent blocked on a spawnSync child.
        const script = join(dir, "generator.ts");
        writeFileSync(
            script,
            `import { spawnSync } from "node:child_process";
spawnSync("sh", ["-c", ${JSON.stringify(`sleep 300 & echo $! > ${pidFile}; wait`)}]);
`
        );

        const answered = generate("a stuck generator", [script], 3_000);

        expect(answered).toBe(false);
        expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
    }, 30_000);

    it("a generator that answers in time is an answer, its exit code read through", () => {
        const script = join(dir, "generator.ts");
        writeFileSync(script, "process.exit(0);\n");
        expect(generate("a quick generator", [script], 20_000)).toBe(true);

        writeFileSync(script, "process.exit(3);\n");
        expect(generate("a failing generator", [script], 20_000)).toBe(false);
    }, 60_000);
});
