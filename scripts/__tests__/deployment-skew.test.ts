// Deployment/tree skew (issues #6132, #6133): the walk's deployment serves the
// PRIMARY checkout's convex/ tree; a walk against any other code is INFRA,
// never a tree failure.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    DEPLOYMENT_SKEW_EXIT,
    deploymentSkew,
    primaryBranchRefusal,
    readDeploymentSkew,
    type SkewInput,
} from "../lib/deployment-skew";
import { infraCause, INFRA_REMEDY, stepVerdict } from "../lib/health-verdict";
import { walkRunVerdict } from "../ui-gate/infra-verdict";
import {
    DeploymentDownAbort,
    untilDeploymentDown,
    watchDeployment,
} from "../ui-gate/deployment-watch";

const CLEAN: SkewInput = {
    base: "staging",
    primaryBranch: "staging",
    primaryHead: "aaaaaaaa1111",
    walkedHead: "aaaaaaaa1111",
    primaryDirty: [],
    convexDiff: [],
    ownDiff: [],
    primaryAhead: false,
};

describe("deploymentSkew — the pure decision", () => {
    it("a clean primary on base with the walked convex/ tree is ok", () => {
        expect(deploymentSkew(CLEAN)).toEqual({ kind: "ok" });
    });

    it("a primary off the base branch is a skew naming the branch", () => {
        const d = deploymentSkew({ ...CLEAN, primaryBranch: "main" });
        expect(d.kind).toBe("skew");
        expect(d.kind === "skew" && d.reason).toMatch(
            /on `main`, not `staging`/
        );
        const detached = deploymentSkew({ ...CLEAN, primaryBranch: null });
        expect(detached.kind === "skew" && detached.reason).toMatch(
            /detached HEAD/
        );
    });

    it("uncommitted convex/ changes in the primary are a skew", () => {
        const d = deploymentSkew({
            ...CLEAN,
            primaryDirty: ["convex/game.ts"],
        });
        expect(d.kind === "skew" && d.reason).toMatch(
            /uncommitted convex\/ changes .*convex\/game\.ts/
        );
    });

    it("a convex/ diff between the primary and the walked tree is a skew naming both shas", () => {
        const d = deploymentSkew({
            ...CLEAN,
            primaryHead: "02bd75cc5aaa",
            walkedHead: "f8adbb827bbb",
            convexDiff: ["convex/definitionManifest.ts"],
        });
        expect(d.kind).toBe("skew");
        const reason = d.kind === "skew" ? d.reason : "";
        expect(reason).toContain("02bd75cc");
        expect(reason).toContain("f8adbb82");
        expect(reason).toContain("convex/definitionManifest.ts");
    });

    it("a primary AHEAD of the walked tree's base on base is ok — newer base code", () => {
        expect(
            deploymentSkew({
                ...CLEAN,
                convexDiff: ["convex/gameReads.ts"],
                primaryAhead: true,
            })
        ).toEqual({ kind: "ok" });
        // …but ahead never excuses an off-base or dirty primary.
        expect(
            deploymentSkew({
                ...CLEAN,
                primaryAhead: true,
                primaryBranch: "main",
            }).kind
        ).toBe("skew");
        expect(
            deploymentSkew({
                ...CLEAN,
                primaryAhead: true,
                primaryDirty: ["convex/x.ts"],
            }).kind
        ).toBe("skew");
    });

    it("a diff made only of the walked tree's own convex/ changes is ok", () => {
        expect(
            deploymentSkew({
                ...CLEAN,
                convexDiff: ["convex/game.ts"],
                ownDiff: ["convex/game.ts", "convex/other.ts"],
            })
        ).toEqual({ kind: "ok" });
        // …and one foreign path beside them is still a skew.
        expect(
            deploymentSkew({
                ...CLEAN,
                convexDiff: ["convex/game.ts", "convex/gameReads.ts"],
                ownDiff: ["convex/game.ts"],
            }).kind
        ).toBe("skew");
    });

    it("primaryBranchRefusal is null only on the base branch", () => {
        expect(primaryBranchRefusal("staging", "staging")).toBeNull();
        expect(primaryBranchRefusal("main", "staging")).not.toBeNull();
        expect(primaryBranchRefusal(null, "staging")).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The git half, on a real repository: a primary checkout and a linked worktree
// share one object store, which is what lets the walked tree diff against the
// primary's HEAD.
// ─────────────────────────────────────────────────────────────────────────────

let tmp: string;
let primary: string;
let walked: string;
const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-skew-"));
    primary = path.join(tmp, "repo");
    fs.mkdirSync(path.join(primary, "convex", "_generated"), {
        recursive: true,
    });
    git(primary, "init", "-q", "-b", "staging");
    git(primary, "config", "user.email", "t@example.invalid");
    git(primary, "config", "user.name", "test");
    fs.writeFileSync(path.join(primary, "convex", "game.ts"), "v1\n");
    fs.writeFileSync(
        path.join(primary, "convex", "_generated", "api.d.ts"),
        "g\n"
    );
    git(primary, "add", "-A");
    git(primary, "commit", "-qm", "init");
    git(primary, "branch", "main");
    walked = path.join(tmp, "repo-walk");
    git(primary, "worktree", "add", "-q", walked, "-b", "feat/x");
});

afterAll(() => {
    fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

describe("readDeploymentSkew — the inputs read from git", () => {
    it("ok when the walked tree matches; codegen drift is ignored", () => {
        fs.writeFileSync(
            path.join(primary, "convex", "_generated", "api.d.ts"),
            "regenerated\n"
        );
        expect(
            readDeploymentSkew({ primary, base: "staging", walked })
        ).toEqual({ kind: "ok" });
        git(primary, "checkout", "-q", "--", "convex/_generated/api.d.ts");
    });

    it("a walked working-tree convex/ edit is a skew, unless it is the tree's own diff", () => {
        fs.writeFileSync(path.join(walked, "convex", "game.ts"), "v2\n");
        expect(
            readDeploymentSkew({ primary, base: "staging", walked }).kind
        ).toBe("skew");
        expect(
            readDeploymentSkew({
                primary,
                base: "staging",
                walked,
                ownDiffFrom: "staging",
            })
        ).toEqual({ kind: "ok" });
        git(walked, "checkout", "-q", "--", "convex/game.ts");
    });

    it("a primary moved off base is a skew; a dirty primary is a skew", () => {
        git(primary, "checkout", "-q", "main");
        expect(
            readDeploymentSkew({ primary, base: "staging", walked }).kind
        ).toBe("skew");
        git(primary, "checkout", "-q", "staging");
        fs.writeFileSync(path.join(primary, "convex", "new.ts"), "x\n");
        const d = readDeploymentSkew({ primary, base: "staging", walked });
        expect(d.kind === "skew" && d.reason).toMatch(/convex\/new\.ts/);
        fs.rmSync(path.join(primary, "convex", "new.ts"));
        // A MODIFIED tracked file: its porcelain line starts with a space.
        fs.writeFileSync(path.join(primary, "convex", "game.ts"), "edit\n");
        const m = readDeploymentSkew({ primary, base: "staging", walked });
        expect(m.kind === "skew" && m.reason).toMatch(/: convex\/game\.ts$/);
        git(primary, "checkout", "-q", "--", "convex/game.ts");
    });

    it("a walked commit the primary does not contain is a skew; one it has moved past is not", () => {
        // A commit the deployment is BEHIND: on the walked branch only.
        fs.writeFileSync(path.join(walked, "convex", "game.ts"), "w\n");
        git(walked, "commit", "-qam", "walked-only");
        const ahead = git(walked, "rev-parse", "HEAD");
        expect(
            readDeploymentSkew({
                primary,
                base: "staging",
                walked: { dir: primary, rev: ahead },
            }).kind
        ).toBe("skew");
        // The primary moved ON past the walked tip: newer base code, ok.
        const tip = git(primary, "rev-parse", "HEAD");
        fs.writeFileSync(path.join(primary, "convex", "game.ts"), "v3\n");
        git(primary, "commit", "-qam", "advance");
        expect(
            readDeploymentSkew({
                primary,
                base: "staging",
                walked: { dir: primary, rev: tip },
            })
        ).toEqual({ kind: "ok" });
    });
});

describe("a skew is INFRA / deployment-skew in health, never RED (issue #6132)", () => {
    const outcome = (step: string, exitCode: number) => ({
        ok: false,
        startedAt: 1_000,
        lastSleepAt: null,
        step,
        exitCode,
        output: "",
    });

    it("check:ui exiting DEPLOYMENT_SKEW_EXIT is infra with the deployment-skew cause", () => {
        expect(walkRunVerdict(DEPLOYMENT_SKEW_EXIT, "")).toBe("infra");
        expect(
            infraCause(outcome("check:ui --all", DEPLOYMENT_SKEW_EXIT))
        ).toBe("deployment-skew");
        expect(
            stepVerdict(outcome("check:ui --all", DEPLOYMENT_SKEW_EXIT))
        ).toBe("infra");
        expect(INFRA_REMEDY["deployment-skew"]).not.toContain('"');
    });

    it("the same code from a non-browser step says nothing about the deployment", () => {
        expect(stepVerdict(outcome("test", DEPLOYMENT_SKEW_EXIT))).toBe("red");
    });
});

describe("watchDeployment — a skew arising mid-walk abandons it (issue #6133)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("two consecutive skew readings settle down with skew set, the probe not consulted on the second", async () => {
        let probes = 0;
        let skew: string | null = null;
        const w = watchDeployment({
            probe: async () => {
                probes++;
                return { ok: true };
            },
            intervalMs: 15_000,
            now: Date.now,
            timer: {
                setInterval,
                clearInterval: (h) =>
                    clearInterval(h as ReturnType<typeof setInterval>),
            },
            skew: () => skew,
        });
        const run = untilDeploymentDown(() => new Promise<string>(() => {}), w);
        run.catch(() => {});
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probes).toBe(2);
        skew = "the primary checkout is on `main`, not `staging`";
        // One reading is not enough: a fast-forward can be caught mid-write.
        let settled = false;
        void run.catch(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(settled).toBe(false);
        expect(probes).toBe(3);
        await vi.advanceTimersByTimeAsync(15_000);
        const err = await run.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DeploymentDownAbort);
        expect((err as DeploymentDownAbort).down.skew).toBe(true);
        expect((err as DeploymentDownAbort).message).toMatch(
            /serving code other than the walked tree.*on `main`/
        );
        expect(probes).toBe(3);
    });
});
