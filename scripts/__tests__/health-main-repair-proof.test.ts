import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { withoutCorpusExclusion } from "../lib/corpus-exclusion";
import { HOSTED_MACHINE_PREFIX } from "../lib/health-verdict-store";
import { fakeGh, type FakeGh } from "./fake-gh";

/**
 * `health-main` on a declared repair's tip (issue #7657, ADR 0156 Amendment
 * V), driven for real: a scratch primary whose `package.json` stands in every
 * gate and records which ran, a fake `gh` (the verdict store, the pivot's
 * repair issues, the PR the tip merged) and a fake `bunx` (the failing files'
 * vitest run). The RED stands on the commit before the tip, at `test`, naming
 * one `test:app` file; the tip's squash subject names PR #42, which closes
 * the repair issue #7 recorded on the RED. The run must prove the tip by the
 * RED's evidence — that file, then `test:bot` and `test:blade` — and never
 * `check:all` nor `test`; the GREEN carries the repair-proof note. A failing
 * part leaves RED with the usual evidence, marked as a proof's; a tip that
 * merges no declared repair, or `--full`, runs the full gate.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");
const FAILING_FILE = "scripts/__tests__/x.test.ts";
const CORPUS_FILE = "scripts/__tests__/corpus.test.ts";

let tmp: string;
let primary: string;
let gh: FakeGh;
let red: string;
let tip: string;

const git = (args: string[], cwd: string): string => {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 20_000,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
};

const commit = (message: string): string => {
    git(
        [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            message,
        ],
        primary
    );
    return git(["rev-parse", "HEAD"], primary);
};

/** The standing RED at `test`, naming the file, written by `machine`, and
 *  the repair issue #7 recorded on it by `health:fix repair-issue`. */
function seedRed(machine = "macbook"): void {
    gh.seed(red, {
        state: "failure",
        context: "health",
        description: `RED · test · ${machine} · failure: assertion · tests: ${FAILING_FILE}`,
    });
    gh.seed(red, {
        state: "pending",
        context: "health-fix",
        description: "AMBER · repair · macbook · issues: 7",
    });
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-health-repair-"));
    const bare = path.join(tmp, "origin.git");
    primary = path.join(tmp, "primary");
    git(["init", "-q", "--bare", bare], tmp);
    git(["init", "-q", "-b", BASE_BRANCH, primary], tmp);
    const ok = "true";
    fs.writeFileSync(
        path.join(primary, "package.json"),
        JSON.stringify({
            scripts: {
                "worktree:init": ok,
                "derive:sync": "bun fake-derive.js",
                "check:all": "bun ran.js check:all",
                "check:gaps": "bun ran.js check:gaps",
                "check:targets": "bun ran.js check:targets",
                "check:cube-ratings": "bun ran.js check:cube-ratings",
                "check:test-hygiene": "bun ran.js check:test-hygiene",
                "check:issue-log-comments":
                    "bun ran.js check:issue-log-comments",
                "check:duplicate-test-blocks":
                    "bun ran.js check:duplicate-test-blocks",
                test: "bun ran.js test",
                "test:app": "bun ran.js test:app",
                "test:bot": "bun ran.js test:bot",
                "test:blade": "bun ran.js test:blade",
            },
        })
    );
    fs.writeFileSync(
        path.join(primary, "fake-derive.js"),
        `console.log("derive:sync: this tree is derived-fresh");\n`
    );
    // Every step records its name; `FAKE_<NAME>_EXIT` fails it.
    fs.writeFileSync(
        path.join(primary, "ran.js"),
        `const name = process.argv[2];
require("fs").appendFileSync(process.env.STEP_RUNS, name + "\\n");
process.exit(Number(process.env["FAKE_" + name.toUpperCase().replace(/[:-]/g, "_") + "_EXIT"] ?? "0"));
`
    );
    fs.mkdirSync(path.join(primary, "scripts", "__tests__"), {
        recursive: true,
    });
    fs.writeFileSync(
        path.join(primary, FAILING_FILE),
        "// the RED's failing file, run by the fake bunx\n"
    );
    // A test that reads the locked corpus (`readsLockedCorpus`): a hosted
    // RED's run skipped it.
    fs.writeFileSync(
        path.join(primary, CORPUS_FILE),
        'import "./committedVerdictCorpus.fixture";\n'
    );
    git(["add", "-A"], primary);
    red = commit("culprit (#41)");
    tip = commit("Revert PR #41: the culprit (#42)");
    git(["remote", "add", "origin", bare], primary);
    git(["push", "-q", "origin", BASE_BRANCH], primary);
    fs.mkdirSync(healthDir(), { recursive: true });
    gh = fakeGh(path.join(tmp, "fake-gh"));
    // The fake `bunx`: records its argv, prints `FAKE_VITEST_OUTPUT`, exits
    // `FAKE_VITEST_EXIT`.
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
        path.join(bin, "bunx"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$VITEST_RUNS"\nprintf '%s' "$FAKE_VITEST_OUTPUT"\nexit "\${FAKE_VITEST_EXIT:-0}"\n`
    );
    fs.chmodSync(path.join(bin, "bunx"), 0o755);
});

afterEach(() => {
    fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

const healthDir = () => path.join(primary, ".claude", "telemetry", "health");
const lastJson = () =>
    JSON.parse(
        fs.readFileSync(path.join(healthDir(), "last.json"), "utf8")
    ) as Record<string, unknown>;
const lines = (file: string) =>
    fs.existsSync(path.join(tmp, file))
        ? fs
              .readFileSync(path.join(tmp, file), "utf8")
              .split("\n")
              .filter(Boolean)
        : [];
const stepRuns = () => lines("step-runs.txt");
const vitestRuns = () => lines("vitest-runs.txt");
const tipHealth = (sha = tip) =>
    gh.statuses(sha).find((s) => s.context === "health");

function healthMain(args: string[], extra: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = {
        ...withoutCorpusExclusion(),
        ...gh.env,
        PATH: `${path.join(tmp, "bin")}:${gh.env.PATH}`,
        STEP_RUNS: path.join(tmp, "step-runs.txt"),
        VITEST_RUNS: path.join(tmp, "vitest-runs.txt"),
        ...extra,
    };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    return spawnSync(
        "bun",
        [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, "--under-lock", ...args],
        { cwd: primary, encoding: "utf8", timeout: 90_000, env }
    );
}

describe("health-main — a declared repair's tip is GREEN on the RED's evidence (issue #7657)", () => {
    it("runs the RED's failing file, then test:bot and test:blade — never check:all nor test — and the GREEN carries the repair-proof note", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        const r = healthMain([]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toMatch(
            /merges PR #42, a declared repair of the RED @ \w{8} — proving it by the RED's evidence/
        );
        expect(vitestRuns()).toEqual([`vitest run ${FAILING_FILE}`]);
        expect(stepRuns()).toEqual(["test:bot", "test:blade"]);
        const note = "repair: failing files + 2 unreached steps green";
        expect(lastJson()).toMatchObject({
            sha: tip,
            status: "green",
            proof: "repair",
            repairNote: note,
        });
        expect(tipHealth()).toMatchObject({ state: "success" });
        expect(tipHealth()?.description).toContain(note);
        expect(tipHealth()?.description).toContain("proof: repair");
        expect(r.stdout).toMatch(/GREEN @ \w{8} \(repair: .*not the full gate/);
    }, 120_000);

    it("a failing file leaves RED at `test` with the usual evidence, marked as a proof's; no unreached step runs", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        const r = healthMain([], {
            FAKE_VITEST_EXIT: "1",
            FAKE_VITEST_OUTPUT: ` FAIL  |node-tooling| ${FAILING_FILE} > still red\n      Tests  1 failed (1)\n`,
        });
        expect(r.status).toBe(1);
        expect(stepRuns()).toEqual([]);
        expect(lastJson()).toMatchObject({
            status: "red",
            failedStep: "test",
            failure: "assertion",
            tests: [FAILING_FILE],
            proof: "repair",
        });
        expect(tipHealth()).toMatchObject({ state: "failure" });
        expect(tipHealth()?.description).toContain(`tests: ${FAILING_FILE}`);
        expect(tipHealth()?.description).toContain("proof: repair");
        // The evidence, published on the tip as for any RED.
        expect(gh.comments(tip).some((c) => c.includes("Health RED"))).toBe(
            true
        );
    }, 120_000);

    it("a failing unreached chain tier leaves RED at step `test` (the ladder's name), the tier named on the terminal", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        const r = healthMain([], { FAKE_TEST_BOT_EXIT: "1" });
        expect(r.status).toBe(1);
        expect(vitestRuns()).toEqual([`vitest run ${FAILING_FILE}`]);
        expect(stepRuns()).toEqual(["test:bot"]);
        expect(r.stdout).toMatch(/test:bot failed — recorded at step test/);
        expect(lastJson()).toMatchObject({
            status: "red",
            failedStep: "test",
            proof: "repair",
        });
        expect(tipHealth()).toMatchObject({ state: "failure" });
    }, 120_000);

    it("an unreached step whose gate never ran (exit 77) is INFRA, not RED", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        const r = healthMain([], { FAKE_TEST_BLADE_EXIT: "77" });
        expect(r.status).toBe(1);
        expect(stepRuns()).toEqual(["test:bot", "test:blade"]);
        expect(lastJson()).toMatchObject({
            status: "infra",
            infraCause: "gate-not-run",
        });
        expect(tipHealth()).toMatchObject({ state: "error" });
    }, 120_000);

    it("a RED a GitHub-hosted run wrote adds the corpus tests its run skipped", () => {
        seedRed(`${HOSTED_MACHINE_PREFIX}runner-1`);
        gh.seedPr(tip, 42, [7]);
        const r = healthMain([]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(vitestRuns()).toEqual([
            `vitest run ${CORPUS_FILE} ${FAILING_FILE}`,
        ]);
        expect(lastJson()).toMatchObject({
            status: "green",
            repairNote:
                "repair: failing files + corpus tests + 2 unreached steps green",
        });
    }, 120_000);

    it("a failing file the repair renamed runs at its new path; one it deleted is not run", () => {
        seedRed();
        git(["mv", FAILING_FILE, "scripts/__tests__/x-moved.test.ts"], primary);
        git(["rm", "-q", CORPUS_FILE], primary);
        const moved = commit("move the test (#43)");
        git(["push", "-q", "origin", BASE_BRANCH], primary);
        gh.seedPr(moved, 43, [7]);
        gh.seed(red, {
            state: "failure",
            context: "health",
            description: `RED · test · macbook · tests: ${FAILING_FILE},${CORPUS_FILE}`,
        });
        const r = healthMain([]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toMatch(/1 renamed since the RED/);
        expect(r.stdout).toMatch(/1 deleted since the RED, not run/);
        expect(vitestRuns()).toEqual([
            "vitest run scripts/__tests__/x-moved.test.ts",
        ]);
        expect(lastJson()).toMatchObject({ status: "green", proof: "repair" });
    }, 120_000);

    it("a failing file missing from the tip for no reason the diff explains is the full gate", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        gh.seed(red, {
            state: "failure",
            context: "health",
            description: `RED · test · macbook · tests: ${FAILING_FILE},scripts/__tests__/never-existed.test.ts`,
        });
        const r = healthMain([]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toMatch(
            /never-existed\.test\.ts is not in this tree and neither renamed nor deleted since the RED; the full gate runs/
        );
        expect(vitestRuns()).toEqual([]);
        expect(stepRuns()).toContain("check:all");
        expect(lastJson().proof).toBeUndefined();
    }, 120_000);

    it("a tip whose PR closes no declared repair issue runs the full gate", () => {
        seedRed();
        gh.seedPr(tip, 42, [8]);
        const r = healthMain([]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).not.toMatch(/proving it by the RED's evidence/);
        expect(vitestRuns()).toEqual([]);
        expect(stepRuns()).toContain("check:all");
        expect(stepRuns()).toContain("test");
        expect(lastJson()).toMatchObject({ status: "green" });
        expect(lastJson().proof).toBeUndefined();
        expect(tipHealth()?.description).not.toContain("repair:");
    }, 120_000);

    it("--full runs the full gate on a repair tip, by hand", () => {
        seedRed();
        gh.seedPr(tip, 42, [7]);
        const r = healthMain(["--full"]);
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(vitestRuns()).toEqual([]);
        expect(stepRuns()).toContain("check:all");
        expect(lastJson().proof).toBeUndefined();
    }, 120_000);
});
