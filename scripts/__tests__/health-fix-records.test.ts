import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeStatus, lineageOf } from "../lib/health-verdict-store";
import { fakeGh, type FakeGh } from "./fake-gh";

/**
 * The two records `health-cadence` used to write for `land` and `/health-fix`
 * and `health:fix` now writes (issue #5655): the AMBER a proved repair earns
 * and the repair issue recorded against a standing RED. Both go to the
 * verdict store — GitHub commit statuses — which a fake `gh` stands in for.
 */
const HEALTH_FIX = resolve(__dirname, "..", "health-fix.ts");

let root: string;
let gh: FakeGh;
let red: string;
let repair: string;

const git = (...a: string[]) =>
    spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();
const commit = (msg: string) =>
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        msg
    );

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "health-fix-records-"));
    git("init", "-q", "-b", "staging");
    commit("red");
    red = git("rev-parse", "HEAD");
    commit("repair");
    repair = git("rev-parse", "HEAD");
    gh = fakeGh(join(root, "fake-gh"));
    gh.seed(red, {
        state: "failure",
        context: "health",
        description: "RED · test:app · other-machine",
    });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const fix = (...args: string[]) =>
    spawnSync("bun", [HEALTH_FIX, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, ...gh.env },
    });

describe("health:fix amber — a proved repair marks the lineage AMBER (issue #5462)", () => {
    it("writes an AMBER health status on the repair's tip naming the RED it repairs", () => {
        const r = fix("amber", `--sha=${repair}`, `--repair-of=${red}`);
        expect(r.status, r.stderr).toBe(0);
        const posted = gh.statuses(repair).find((s) => s.context === "health");
        expect(posted?.state).toBe("pending");
        expect(
            decodeStatus({
                sha: repair,
                state: posted!.state,
                description: posted!.description,
                targetUrl: null,
                createdAt: null,
            })
        ).toMatchObject({ status: "amber", repairOf: red });
    });

    it("refuses a malformed sha, writing nothing", () => {
        const r = fix("amber", "--sha=abc", `--repair-of=${red}`);
        expect(r.status).toBe(2);
        expect(gh.statuses(repair)).toEqual([]);
    });
});

describe("health:fix repair-issue — the issue that repairs the standing RED (issue #4964)", () => {
    it("records the issue on the RED tip's health-fix status, readable by the other machine", () => {
        const r = fix("repair-issue", "--issue=7");
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/repair issue #7 recorded/);
        const posted = gh.statuses(red).find((s) => s.context === "health-fix");
        expect(posted?.description).toContain("issues: 7");
    });

    it("says so, and writes nothing, when no RED stands", () => {
        gh = fakeGh(join(root, "fake-gh-empty"));
        const r = fix("repair-issue", "--issue=7");
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/not recorded/);
        expect(gh.statuses(red)).toEqual([]);
    });

    it("refuses a missing or non-numeric issue", () => {
        expect(fix("repair-issue").status).toBe(2);
        expect(fix("repair-issue", "--issue=abc").status).toBe(2);
    });
});

describe("the lineage after the AMBER", () => {
    it("RED then AMBER on a later tip reads as amber (picks resume)", () => {
        fix("amber", `--sha=${repair}`, `--repair-of=${red}`);
        const history = [repair, red].map((sha) => {
            const s = gh.statuses(sha).find((x) => x.context === "health")!;
            return decodeStatus({
                sha,
                state: s.state,
                description: s.description,
                targetUrl: null,
                createdAt: null,
            })!;
        });
        expect(lineageOf(history).kind).toBe("amber");
    });
});
