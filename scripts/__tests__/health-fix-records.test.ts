import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeStatus, lineageOf } from "../lib/health-verdict-store";
import { fakeGh, type FakeGh } from "./fake-gh";

/**
 * The two records `health:fix` writes: the AMBER a proved repair earns and the
 * repair issue recorded against a standing RED. Both go to the verdict store
 * — GitHub commit statuses — which a fake `gh` stands in for.
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
    // What the repair proof runs on the tip: the test the RED names, and the
    // `derive:regenerate` it rebuilds first (a no-op in a fixture).
    writeFileSync(join(root, "probe.test.ts"), "");
    writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { "derive:regenerate": "true" } })
    );
    git("add", "probe.test.ts", "package.json");
    commit("repair");
    repair = git("rev-parse", "HEAD");
    gh = fakeGh(join(root, "fake-gh"));
    gh.seed(red, {
        state: "failure",
        context: "health",
        description: "RED · test:app · other-machine · tests: probe.test.ts",
    });
});
afterEach(() =>
    rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    })
);

const fix = (...args: string[]) =>
    spawnSync("bun", [HEALTH_FIX, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, ...gh.env },
    });

/** The push merges PR #9, which closes the issue recorded as the repair. */
const declareRepair = () => {
    fix("repair-issue", "--issue=7");
    gh.seedPr(repair, 9, [7]);
};

/** The exit code the repair proof's test run answers: `bunx`, on the fake's
 *  PATH, in place of vitest. */
const proofExits = (code: number) => {
    const bin = join(root, "fake-gh", "bin", "bunx");
    writeFileSync(bin, `#!/bin/sh\nexit ${code}\n`);
    chmodSync(bin, 0o755);
};

/** `health-early`'s step: on the merged tip, with `$GITHUB_OUTPUT`. */
const amber = (sha = repair) =>
    spawnSync("bun", [HEALTH_FIX, "amber", `--sha=${sha}`], {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            ...gh.env,
            GITHUB_OUTPUT: join(root, "gh-output"),
        },
    });
const tellsJobToRegate = () =>
    existsSync(join(root, "gh-output")) &&
    readFileSync(join(root, "gh-output"), "utf8").includes("amber=true");
const healthOn = (sha: string) =>
    gh.statuses(sha).filter((s) => s.context === "health");

describe("health:fix amber — a proved repair marks the lineage AMBER (issue #7990)", () => {
    it("a merged declared repair whose named test passes: AMBER on the tip, naming the RED, and the job re-gates", () => {
        declareRepair();
        proofExits(0);
        const r = amber();
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
        expect(tellsJobToRegate()).toBe(true);
    });

    it("the named test still red on the tip: no AMBER, and a merged PR is never failed for it", () => {
        declareRepair();
        proofExits(1);
        const r = amber();
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/still red on the tip: probe\.test\.ts/);
        expect(healthOn(repair)).toEqual([]);
        expect(tellsJobToRegate()).toBe(false);
    });

    it("a push merging no declared repair: no AMBER, even with the test green", () => {
        proofExits(0);
        const r = amber();
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/merges no declared repair/);
        expect(healthOn(repair)).toEqual([]);
    });

    it("refuses a malformed sha, writing nothing", () => {
        const r = amber("abc");
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
        declareRepair();
        proofExits(0);
        amber();
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
