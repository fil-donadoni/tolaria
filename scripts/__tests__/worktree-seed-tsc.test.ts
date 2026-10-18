/**
 * A seeded `.tsbuildinfo` must never let `tsc -b` skip a project (issue
 * #5971).
 *
 * `seedWorktreeCaches` copies the primary's buildinfo into a fresh worktree so
 * the lane's `tsc -b --noEmit` starts warm (issue #3776). `tsc -b` decides
 * "up to date" by TIMESTAMP before it ever reads the per-file hashes: a copy
 * stamped newer than the checked-out sources made every project "up to date
 * because newest input is older than output", and `check:ts` exited 0 on a
 * tree with a type error — the tip went RED only on a cold runner.
 *
 * The guard is the behaviour, not the mechanism: a real `tsc -b` over a tiny
 * project, built green in a scratch primary, seeded into a scratch worktree
 * whose source is broken, must FAIL there. Any seeding change that brings the
 * vacuous pass back — whatever its cause — reds here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedWorktreeCaches, TSBUILDINFO_DIR } from "../lib/worktree-seed";

const TSC = path.resolve(__dirname, "../../node_modules/typescript/bin/tsc");

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        incremental: true,
        tsBuildInfoFile: `./${TSBUILDINFO_DIR}/tsconfig.tiny.tsbuildinfo`,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
    },
    include: ["a.ts"],
});

function write(root: string, rel: string, content: string): void {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function tscBuild(cwd: string) {
    return spawnSync(process.execPath, [TSC, "-b", "--verbose"], {
        cwd,
        encoding: "utf8",
    });
}

describe("seeded tsbuildinfo never makes tsc -b vacuous (issue #5971)", () => {
    let tmp: string;
    let primary: string;
    let cwd: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-seed-tsc-"));
        primary = path.join(tmp, "tolaria");
        cwd = path.join(tmp, "tolaria-issue-1");
        write(primary, "tsconfig.json", TSCONFIG);
        write(primary, "a.ts", "export const n: number = 1;\n");
        const green = tscBuild(primary);
        expect(green.status, green.stdout + green.stderr).toBe(0);
        // The worktree's sources are checked out BEFORE the seed runs, as
        // `git worktree add` + `worktree:init` do.
        write(cwd, "tsconfig.json", TSCONFIG);
        write(cwd, "a.ts", 'export const n: number = "not a number";\n');
    });

    afterAll(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("type-checks the seeded worktree and reports its error", () => {
        const report = seedWorktreeCaches({ primary, cwd });
        expect(report.done.join("\n")).toContain("tsconfig.tiny.tsbuildinfo");

        const run = tscBuild(cwd);
        const out = run.stdout + run.stderr;
        expect(out).not.toMatch(/is up to date because newest input/);
        expect(out).toMatch(/TS2322/);
        expect(run.status).not.toBe(0);
    });
});
