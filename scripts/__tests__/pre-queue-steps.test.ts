import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyLane, type RelatedTests } from "../check-lane";
import {
    isTransientPushFailure,
    landRefusals,
    pushWithRetry,
    REGENERATE_STEP,
    runPreQueue,
} from "../land-ready";
import { ORIGIN_BASE } from "../lib/branches";
import type { Lineage } from "../lib/health-verdict-store";
import { SKIN_RECEIPT_REFUSAL } from "../land";
import {
    EXCLUDED_FROM_PRE_QUEUE,
    isCheapStep,
    preQueueSteps,
} from "../lib/pre-queue-steps";

const none: RelatedTests = {
    "node-engine": [],
    "node-tooling": [],
    dom: [],
};
const related = (reach: Partial<RelatedTests>) => () => ({ ...none, ...reach });

describe("preQueueSteps — the lane's own plan, filtered (issue #5554)", () => {
    it("keeps every step the engine lane plans except the not-seconds-cost ones", () => {
        const files = ["convex/gre/foo.ts"];
        const plan = classifyLane(
            files,
            files,
            related({ "node-engine": ["convex/gre/__tests__/foo.test.ts"] })
        );
        const { run } = preQueueSteps(plan, [], files);
        // Derived, not declared: every planned id survives unless excluded.
        const kept = plan.run
            .filter((c) => !(c.id in EXCLUDED_FROM_PRE_QUEUE))
            .map((c) => c.id);
        expect([...run.map((c) => c.id)].sort()).toEqual([...kept].sort());
        expect(run.map((c) => c.id)).toContain("tsc[all]");
        expect(run.map((c) => c.id)).toContain("cr:lint");
    });

    it("drops a vitest run that resolves to a whole project, with a reason", () => {
        const files = ["convex/gre/types.ts"];
        const reach = Array.from({ length: 401 }, (_, i) => `t${i}.test.ts`);
        const plan = classifyLane(
            files,
            files,
            related({ "node-engine": reach })
        );
        const { run, skip } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("vitest(related)");
        expect(skip.map((s) => s.id)).toContain("vitest(related)");
    });

    it("drops check:pr from a full-lane diff but keeps its cheap guards", () => {
        const files = ["package.json", "src/a.tsx", "convex/b.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("check:pr");
        expect(run.map((c) => c.id)).toEqual(
            expect.arrayContaining(["tsc[all]", "cr:lint", "format(diff)"])
        );
        expect(run.map((c) => c.id)).toContain("check:gaps");
    });

    it("a NEW scripts test file also runs the docs-lane census", () => {
        const added = ["scripts/__tests__/brand-new.test.ts"];
        const plan = classifyLane(added, added, related({}));
        const { run } = preQueueSteps(plan, added, added);
        const guard = run.find((c) => c.id === "vitest(new-file guards)");
        expect(guard?.command).toContain("scripts/__tests__/docs-lane.test.ts");
    });

    it("a MODIFIED test file does not pull the new-file guards", () => {
        const files = ["scripts/__tests__/old.test.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.map((c) => c.id)).not.toContain("vitest(new-file guards)");
    });

    it("runs a touched test file the lane did not plan (cards diff)", () => {
        const files = ["convex/cards/sets/x.test.ts"];
        const plan = classifyLane(files, files, related({}));
        const { run } = preQueueSteps(plan, [], files);
        expect(run.find((c) => c.id === "vitest(touched)")?.command).toContain(
            "convex/cards/sets/x.test.ts"
        );
    });
});

describe("runPreQueue — red refuses", () => {
    const files = ["convex/gre/foo.ts"];
    const plan = classifyLane(files, files, related({}));
    const run = (failing: string | null) =>
        runPreQueue({
            plan,
            added: [],
            present: files,
            log: () => undefined,
            regenerate: () => true,
            restore: () => undefined,
            exec: (command) => ({
                ok: failing === null || !command.includes(failing),
                ms: 1,
            }),
        });

    it("a type error (tsc[all] red) is reported as the failing step", () => {
        expect(run("bun run check:ts").failed).toBe("tsc[all]");
    });

    it("an unclassified new test file (docs-lane census red) is reported", () => {
        const added = ["scripts/__tests__/brand-new.test.ts"];
        const r = runPreQueue({
            plan: classifyLane(added, added, related({})),
            added,
            present: added,
            log: () => undefined,
            regenerate: () => true,
            restore: () => undefined,
            exec: (command) => ({
                ok: !command.includes("docs-lane.test.ts"),
                ms: 1,
            }),
        });
        expect(r.failed).toBe("vitest(new-file guards)");
    });

    it("all green → null", () => {
        expect(run(null).failed).toBeNull();
    });
});

// Issue #6491 — the pre-queue steps judge the tree the queue's draft would
// (`check:lane --regenerate-derived`): rebuilt derived state, restored after.
describe("runPreQueue — derived state is rebuilt around the steps", () => {
    const files = ["convex/gre/foo.ts"];
    const plan = classifyLane(files, files, related({}));
    const drive = (opts: { regenOk?: boolean; failing?: string } = {}) => {
        const calls: string[] = [];
        const r = runPreQueue({
            plan,
            added: [],
            present: files,
            log: () => undefined,
            regenerate: () => {
                calls.push("regenerate");
                return opts.regenOk ?? true;
            },
            restore: () => {
                calls.push("restore");
            },
            exec: (command) => {
                calls.push("step");
                return {
                    ok: !opts.failing || !command.includes(opts.failing),
                    ms: 1,
                };
            },
        });
        return { calls, r };
    };

    it("regenerates before the first step and restores after the last", () => {
        const { calls } = drive();
        expect(calls[0]).toBe("regenerate");
        expect(calls.at(-1)).toBe("restore");
        expect(calls.filter((c) => c === "step").length).toBeGreaterThan(0);
        expect(calls.filter((c) => c !== "step")).toEqual([
            "regenerate",
            "restore",
        ]);
    });

    it("restores even when a step is red", () => {
        const { calls, r } = drive({ failing: "bun run check:ts" });
        expect(r.failed).toBe("tsc[all]");
        expect(calls.at(-1)).toBe("restore");
    });

    it("a restore that throws does not replace the step verdict", () => {
        const r = runPreQueue({
            plan,
            added: [],
            present: files,
            log: () => undefined,
            regenerate: () => true,
            restore: () => {
                throw new Error("boom");
            },
            exec: (command) => ({
                ok: !command.includes("bun run check:ts"),
                ms: 1,
            }),
        });
        expect(r.failed).toBe("tsc[all]");
    });

    it("a failed regenerate is the first red, runs only the cheap tier, still restores", () => {
        const { calls, r } = drive({ regenOk: false });
        expect(r.failed).toBe(REGENERATE_STEP);
        expect(calls[0]).toBe("regenerate");
        expect(calls.at(-1)).toBe("restore");
        const ran = r.result.outcomes.filter((o) => o.status !== "not-run");
        expect(ran.slice(1).every((o) => o.id !== "tsc[all]")).toBe(true);
    });
});

// Issue #6620 — cheap refusals first, every red at once.
describe("runPreQueue — cheap tier first, all reds at once (issue #6620)", () => {
    const files = ["convex/gre/foo.ts", "scripts/__tests__/brand-new.test.ts"];
    const plan = classifyLane(files, files, related({}));
    const drive = (failing: string[], regenOk = true) => {
        const ran: string[] = [];
        const r = runPreQueue({
            plan,
            added: ["scripts/__tests__/brand-new.test.ts"],
            present: files,
            log: () => undefined,
            regenerate: () => regenOk,
            restore: () => undefined,
            exec: (command) => {
                ran.push(command);
                return { ok: !failing.some((f) => command.includes(f)), ms: 1 };
            },
        });
        return { ran, r };
    };

    it("orders every cheap step before any step that runs tests or tsc", () => {
        const { run } = preQueueSteps(plan, [], files);
        const firstCostly = run.findIndex((c) => !isCheapStep(c));
        expect(firstCostly).toBeGreaterThan(0);
        expect(run.slice(firstCostly).some(isCheapStep)).toBe(false);
        expect(run.slice(0, firstCostly).map((c) => c.id)).toContain(
            "check:issue-log-comments"
        );
    });

    it("names every red of the cheap tier in one run and starts no test", () => {
        const { ran, r } = drive(
            ["check:gaps", "check:issue-log-comments", "cr:lint"],
            false
        );
        expect(r.failedAll).toEqual([
            REGENERATE_STEP,
            "cr:lint",
            "check:gaps",
            "check:issue-log-comments",
        ]);
        expect(ran.some((c) => c.includes("vitest"))).toBe(false);
        expect(ran.some((c) => c.includes("check:ts"))).toBe(false);
    });

    it("a standing refusal skips the costly tier even when the cheap tier is green", () => {
        const ran: string[] = [];
        const r = runPreQueue({
            plan,
            added: [],
            present: files,
            log: () => undefined,
            regenerate: () => true,
            restore: () => undefined,
            skipCostly: true,
            exec: (command) => {
                ran.push(command);
                return { ok: true, ms: 1 };
            },
        });
        expect(r.failedAll).toEqual([]);
        expect(ran.some((c) => c.includes("check:ts"))).toBe(false);
    });

    it("a green cheap tier runs the costly tier, fail-fast", () => {
        const { ran, r } = drive(["check:ts"]);
        expect(r.failedAll).toEqual(["tsc[all]"]);
        expect(ran.some((c) => c.includes("vitest"))).toBe(false);
    });
});

describe("pushWithRetry — the hand-off push (issue #6620)", () => {
    const rejected = {
        status: 1,
        stderr: "! [remote rejected] HEAD -> feat/x (failure)\nerror: failed to push some refs",
    };
    const nonFf = {
        status: 1,
        stderr: "! [rejected] HEAD -> feat/x (non-fast-forward)\nerror: failed to push some refs",
    };
    const ok = { status: 0, stderr: "" };
    const drive = (replies: { status: number; stderr: string }[]) => {
        let n = 0;
        const sleeps: number[] = [];
        const r = pushWithRetry(
            () => replies[Math.min(n++, replies.length - 1)],
            (ms) => void sleeps.push(ms),
            () => undefined
        );
        return { r, attempts: n, sleeps };
    };

    it("retries a transient rejection and returns the success", () => {
        const { r, attempts, sleeps } = drive([rejected, rejected, ok]);
        expect(r.status).toBe(0);
        expect(attempts).toBe(3);
        expect(sleeps).toEqual([2000, 5000]);
    });

    it("gives up after 3 attempts", () => {
        const { r, attempts } = drive([rejected]);
        expect(r.status).toBe(1);
        expect(attempts).toBe(3);
    });

    it("a non-fast-forward is not retried", () => {
        const { r, attempts } = drive([nonFf, ok]);
        expect(r.status).toBe(1);
        expect(attempts).toBe(1);
        expect(isTransientPushFailure(nonFf.stderr)).toBe(false);
    });

    it("a remote that moved (fetch first) is not retried", () => {
        const fetchFirst = {
            status: 1,
            stderr: "! [rejected] HEAD -> feat/x (fetch first)\nerror: failed to push some refs",
        };
        const { attempts } = drive([fetchFirst, ok]);
        expect(attempts).toBe(1);
    });
});

// Issue #5956 — `land:ready` refuses what `land` would refuse, through the
// SAME `pr-checks` functions, on a real git diff (`origin/<base>...HEAD`).
describe("landRefusals — land's refusals before the PR is queued", () => {
    const repos: string[] = [];
    afterAll(() => {
        for (const r of repos)
            rmSync(r, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
    });

    /** A repo whose `origin/<base>` is the root commit and whose HEAD adds
     *  `files` — the PR's diff. */
    function prRepo(files: string[]): string {
        const root = mkdtempSync(join(tmpdir(), "land-ready-"));
        repos.push(root);
        const git = (...args: string[]) =>
            execFileSync("git", args, { cwd: root, stdio: "pipe" });
        git("init", "-q");
        git("config", "user.email", "t@t");
        git("config", "user.name", "t");
        git("commit", "-q", "--allow-empty", "-m", "base");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        for (const f of files) {
            mkdirSync(dirname(join(root, f)), { recursive: true });
            writeFileSync(join(root, f), "export const x = 1;\n");
        }
        git("add", "-A");
        git("commit", "-q", "-m", "pr");
        return root;
    }

    const noRed = () => ({ kind: "green", verdict: null }) as Lineage;
    const refusalsOf = (files: string[], prBody: string) =>
        landRefusals(
            { cwd: prRepo(files), prBody, lineage: noRed },
            () => undefined
        );

    it("a DOM-reaching PR with no check:ui receipt is refused in land's words", () => {
        const r = refusalsOf(["src/components/game/Thing.tsx"], "Closes #1");
        expect(r).toEqual([`land: refusing — ${SKIN_RECEIPT_REFUSAL}`]);
    });

    it("a convex/gre PR with no preset scenario is refused", () => {
        const r = refusalsOf(["convex/gre/thing.ts"], "Closes #1");
        expect(r).toHaveLength(1);
        expect(r[0]).toMatch(/^land: refusing — .*[Pp]reset scenario/);
    });

    it("a PR that passes every refusal yields none", () => {
        expect(
            refusalsOf(
                ["convex/gre/thing.ts"],
                "## Preset scenario\n\nnone owed — a refactor."
            )
        ).toEqual([]);
    });
});
