import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    refusalReason,
    buildLockedCommand,
    rebaseStep,
    remoteBranchDeleteStep,
    primaryBranchFastForwardStep,
    issueOfBranch,
    releaseClaimStep,
    recordLandingStep,
    gapsSyncStep,
    originBandForBranch,
    healthDetachStep,
    lockedEnv,
    laneStep,
    greenLaneRunOf,
    readGreenLaneRuns,
    gateRunRoot,
    computeSkinReceiptInvalid,
    safeSkinReceiptInvalid,
    skinReceiptInvalidForDiff,
    isTestOnlySrcDiff,
    type LandFacts,
    type LockedCommandOptions,
} from "../land";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "../lib/branches";
import { classifyLane } from "../check-lane";
import {
    classifyScenarioSection,
    owesScenario,
    scenarioRefusal,
} from "../lib/scenario-block";
import { UNWALKED_SURFACES, type Readings } from "../ui-gate/floors.ts";
import {
    DIAGNOSTIC_SEPARATOR,
    diagnosticLines,
    evaluateRun,
    verdictBlockLines,
    zeroReadings,
    type SurfaceWalk,
} from "../ui-gate/receipt.ts";
import { SURFACES, SURFACE_IDS } from "../ui-gate/surfaces.ts";
import { assertLabelsBySurface } from "../ui-gate/assertions.ts";
import { VIEWPORT_IDS } from "../ui-gate/viewports.ts";
import { landingDiffScope } from "../ui-gate/verify-receipt.ts";

const GATE = resolve(__dirname, "..", "gate.ts");

/** The Named Assertions the real surface table declares (issue #3649). */
const PROMISED = assertLabelsBySurface(SURFACES);

/**
 * What `check:ui` prints for `surfaces` (null = every surface, a full RECEIPT;
 * otherwise the SCOPED run of that scope) over the REAL surface table, viewport
 * matrix and declared-unwalked list, rendered by the real evaluator exactly as
 * the lane renders it — verdict block, separator, diagnostic block. `at` sets
 * one cell's readings; `facts` stands in for the run's own diagnostic lines.
 *
 * Every Named Assertion the real table declares is reported kept (issue
 * #3649): these receipts stand for GREEN runs, and a green run keeps its
 * promises. A cell that simply omitted them would be a receipt `land` refuses
 * for missing the lines its scope owes — which is the point of that check, not
 * a property of the lane being modelled here.
 */
function laneReceipt(
    surfaces: readonly string[] | null,
    opts: {
        at?: (surface: string, viewport: string) => Readings | undefined;
        facts?: string[];
    } = {}
): string {
    const known = surfaces ?? SURFACE_IDS;
    const unwalked = new Set(UNWALKED_SURFACES.map((u) => u.surface));
    const walks: SurfaceWalk[] = known
        .filter((surface) => !unwalked.has(surface))
        .map((surface) => ({
            surface,
            status: "measured",
            measurements: VIEWPORT_IDS.map((viewport) => ({
                viewport,
                readings: opts.at?.(surface, viewport) ?? zeroReadings(),
                asserts: (PROMISED[surface] ?? []).map((label) => ({
                    label,
                    ok: true,
                    detail: "",
                })),
            })),
        }));
    const ev = evaluateRun({
        knownSurfaceIds: known,
        walks,
        definedSurfaceIds: SURFACE_IDS,
        viewportIds: VIEWPORT_IDS,
        unwalked: UNWALKED_SURFACES,
        diffScope: surfaces ? { base: ORIGIN_BASE, surfaces } : null,
        assertsBySurface: PROMISED,
    });
    return [
        "```",
        ...verdictBlockLines(ev),
        DIAGNOSTIC_SEPARATOR,
        ...diagnosticLines(ev),
        ...(opts.facts ?? []),
        "```",
    ].join("\n");
}

/**
 * `bun run land <PR#>` (issue #2517) — one `gate.ts heavy` invocation
 * wrapping fetch → rebase → check:lane → push → merge (ADR 0110), so `main`
 * cannot move between "gate green" and "merge" the way it did under the
 * three-separate-steps merge-train.
 *
 * Per repo convention (docs-lane.test.ts, worktree-gc.test.ts): git/gh
 * plumbing stays thin and untested; every DECISION land.ts makes is a pure
 * function, tested directly here. The one exception is the rebase-conflict
 * behaviour, which is proven against a real (local, no-remote) git fixture —
 * a string match cannot tell a genuine `--abort` from a shell fragment that
 * merely LOOKS like one.
 */

describe("land.ts — refusal matrix", () => {
    const clean: LandFacts = {
        branch: "fix/issue-2517",
        dirty: false,
        prState: "OPEN",
        prHeadRefName: "fix/issue-2517",
        prBaseRefName: BASE_BRANCH,
        skinReceiptInvalid: false,
        scenarioRefusal: null,
    };

    it("allows a clean branch with a matching open PR", () => {
        expect(refusalReason(clean)).toBeNull();
    });

    it("refuses on the base branch and on the release branch", () => {
        expect(refusalReason({ ...clean, branch: BASE_BRANCH })).toContain(
            BASE_BRANCH
        );
        expect(refusalReason({ ...clean, branch: RELEASE_BRANCH })).toContain(
            RELEASE_BRANCH
        );
    });

    it("refuses a PR whose base is not the base branch — the API merge lands wherever the PR points (ADR 0116)", () => {
        const r = refusalReason({ ...clean, prBaseRefName: RELEASE_BRANCH });
        expect(r).toContain(`PR targets \`${RELEASE_BRANCH}\``);
        expect(r).toContain(`--base ${BASE_BRANCH}`);
        expect(
            refusalReason({ ...clean, prBaseRefName: "feat/other" })
        ).toContain("PR targets");
    });

    it("refuses a dirty tree", () => {
        expect(refusalReason({ ...clean, dirty: true })).toMatch(/dirty/);
    });

    it("refuses when the PR is not found", () => {
        expect(
            refusalReason({ ...clean, prState: null, prHeadRefName: null })
        ).toMatch(/not found/);
    });

    it("refuses when the PR is not open", () => {
        expect(refusalReason({ ...clean, prState: "MERGED" })).toMatch(
            /not open/
        );
        expect(refusalReason({ ...clean, prState: "CLOSED" })).toMatch(
            /not open/
        );
    });

    it("refuses when the PR head branch does not match the current branch", () => {
        expect(
            refusalReason({ ...clean, prHeadRefName: "someone-elses-branch" })
        ).toMatch(/head branch/);
    });

    it("checks main before dirty — a session on main never needs the dirty check to fire", () => {
        expect(
            refusalReason({ ...clean, branch: BASE_BRANCH, dirty: true })
        ).toMatch(/main/);
    });

    // Proof-of-failure: commented out the `if (facts.dirty)` branch in
    // refusalReason — "refuses a dirty tree" went red (refusalReason
    // returned null instead of the dirty-tree reason). Reverted.

    // Issue #2760 — `land` refuses a `skin` landing diff whose pasted
    // check:ui receipt failed verification. `skinReceiptInvalid` is a
    // PRE-COMPUTED fact (`lane === "skin" && !verifyReceiptText(body).ok`)
    // by the time it reaches `refusalReason` — this suite proves only the
    // refusal-matrix side (the flag is checked, and checked last, after the
    // cheaper structural facts); `verify-receipt.test.ts` proves the flag
    // itself is computed correctly.
    it("refuses a skin diff with an invalid receipt", () => {
        expect(refusalReason({ ...clean, skinReceiptInvalid: true })).toMatch(
            /check:ui receipt failed verification/
        );
    });

    it("does not refuse when the receipt verified clean (or the diff never reached skin)", () => {
        expect(
            refusalReason({ ...clean, skinReceiptInvalid: false })
        ).toBeNull();
    });

    it("checks head-branch match before the receipt — a branch mismatch never needs the (expensive) receipt fact to fire", () => {
        expect(
            refusalReason({
                ...clean,
                prHeadRefName: "someone-elses-branch",
                skinReceiptInvalid: true,
            })
        ).toMatch(/head branch/);
    });

    // ADR 0044 — the preset-scenario refusal. Like `skinReceiptInvalid` this
    // is a PRE-COMPUTED fact by the time it reaches `refusalReason`
    // (`safeScenarioRefusal` classifies the PR body and the landing diff);
    // this suite proves only the refusal-matrix side. The classification
    // itself is proven in `scenario-block.test.ts` against real PR-body
    // shapes.
    it("refuses when the landing diff owes a preset scenario and the body has none", () => {
        expect(
            refusalReason({
                ...clean,
                scenarioRefusal: "no preset scenario …",
            })
        ).toBe("no preset scenario …");
    });

    it("does not refuse when the scenario check passed", () => {
        expect(refusalReason({ ...clean, scenarioRefusal: null })).toBeNull();
    });

    it("checks the check:ui receipt BEFORE the scenario — both are body facts, and the receipt is the older contract", () => {
        expect(
            refusalReason({
                ...clean,
                skinReceiptInvalid: true,
                scenarioRefusal: "no preset scenario …",
            })
        ).toMatch(/check:ui receipt failed verification/);
    });

    it("checks structural facts before either body fact — a dirty tree never needs them", () => {
        expect(
            refusalReason({
                ...clean,
                dirty: true,
                scenarioRefusal: "no preset scenario …",
            })
        ).toMatch(/dirty/);
    });

    // Proof-of-failure: commented out the `if (facts.skinReceiptInvalid)`
    // branch — "refuses a skin diff with an invalid receipt" went red
    // (refusalReason returned null instead of naming the receipt failure).
    // Reverted. Same for `if (facts.scenarioRefusal)` — "refuses when the
    // landing diff owes a preset scenario and the body has none" went red.
});

describe("land.ts — the locked command", () => {
    const base: LockedCommandOptions = {
        branch: "fix/issue-2517",
        gatedGreen: [],
        laneRecordDir: null,
        pr: 2517,
        primaryCheckout: "/repo",
        worktree: "/repo-issue-2517",
        merge: true,
        teardown: true,
    };

    it("wraps fetch, rebase, the lane gate, the push and the merge in ONE string", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain(`git fetch origin ${BASE_BRANCH}`);
        expect(cmd).toContain(`git rebase ${ORIGIN_BASE}`);
        // The LANE gate, not the full gate (ADR 0110 §3, ADR 0116): the full
        // gate runs once, at `bun run release`, never per landing.
        expect(cmd).toContain("bun run check:lane");
        expect(cmd).not.toContain("bun run check:all");
        expect(cmd).toContain("git push --force-with-lease origin");
        // The merge is `pr-merge.ts` since #2536 (settle-aware retry), but
        // what this test guards is unchanged: it is textually inside the ONE
        // string the heavy lock wraps.
        expect(cmd).toMatch(/bun '[^']*pr-merge\.ts' 2517/);
    });

    it("seeds the preset scenario post-merge, in the PRIMARY checkout, non-gating (ADR 0044)", () => {
        const cmd = buildLockedCommand(base);
        // In the primary checkout: a linked worktree has no `.env.local`, so
        // no `CONVEX_DEPLOYMENT` — a seed run from the worktree would find no
        // deployment at all.
        expect(cmd).toMatch(
            /\(cd '\/repo' && bun '[^']*seed-scenario\.ts' 2517 \|\| true\)/
        );
        // AFTER the merge — there is nothing to register until the PR lands.
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        const seedIdx = cmd.indexOf("seed-scenario.ts");
        expect(seedIdx).toBeGreaterThan(mergeIdx);
        // And past the merged-tip verification, like the rest of the housekeeping.
        expect(seedIdx).toBeGreaterThan(
            cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}`)
        );
    });

    it("seeds AFTER the primary checkout catches up (issue #3253)", () => {
        // `seedScenarioDirect` resolves card names server-side against the
        // DEPLOYED bundle, and the bundle can only hold what is on DISK in the
        // primary checkout. Seeding before the fast-forward seeds against the
        // PRE-merge tree, so a scenario naming the PR's own new card can never
        // resolve — deterministic, not a race, and it silently lost 10 of 14
        // specs before this order was fixed.
        const cmd = buildLockedCommand(base);
        const ffIdx = cmd.indexOf(primaryBranchFastForwardStep("/repo"));
        const seedIdx = cmd.indexOf("seed-scenario.ts");
        expect(ffIdx).toBeGreaterThan(-1);
        expect(seedIdx).toBeGreaterThan(ffIdx);
    });

    it("does not seed at all without a merge (--no-merge gates and pushes only)", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).not.toContain("seed-scenario.ts");
    });

    it("seeds even under --keep — teardown is about the worktree, not the scenario", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain("seed-scenario.ts");
    });

    it("never passes --delete-branch (review round 2, B2)", () => {
        // `gh --delete-branch` switches the LOCAL repo to the default branch
        // before deleting, and `main` is checked out in the primary
        // worktree — `land` runs from a linked worktree — so that step dies
        // with `fatal: 'main' is already used by worktree at …` AFTER the
        // API merge has already landed. Ref cleanup is done explicitly
        // instead (see the two tests below). The flag's absence from the
        // merge ARGV is asserted in pr-merge.test.ts (`mergeArgs`); this test
        // covers the shell string `land` builds around it.
        const cmd = buildLockedCommand(base);
        expect(cmd).not.toContain("--delete-branch");
    });

    it("deletes the remote and local branch refs explicitly, past the merge and its tip verification", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("git push origin --delete 'fix/issue-2517'");
        expect(cmd).toContain("git -C '/repo' branch -D 'fix/issue-2517'");
        const verifyIdx = cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}`);
        expect(verifyIdx).toBeGreaterThan(cmd.indexOf("pr-merge.ts"));
        const remoteDeleteIdx = cmd.indexOf("git push origin --delete");
        const localDeleteIdx = cmd.indexOf("branch -D");
        expect(remoteDeleteIdx).toBeGreaterThan(verifyIdx);
        expect(localDeleteIdx).toBeGreaterThan(verifyIdx);
    });

    it("wraps ref cleanup so it can never gate land's exit status on a merged PR", () => {
        // The remote-branch delete has its own richer wrapper (issue #2877,
        // see `remoteBranchDeleteStep`'s own describe block below for the
        // DIAGNOSTIC-filtering behaviour) — it is asserted to appear here
        // VERBATIM, byte-for-byte, so this test also proves
        // `buildLockedCommand` doesn't reimplement or diverge from it. The
        // worktree-remove and local branch -D steps keep the plain
        // `(… || true)` wrapper: a stale remote, an already-removed
        // worktree, or a branch that will not delete cannot turn a MERGED
        // PR's landing into a reported failure — ref cleanup is cosmetic,
        // the merge is not.
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain(remoteBranchDeleteStep("fix/issue-2517"));
        expect(cmd).toContain(
            "(git -C '/repo' worktree remove --force '/repo-issue-2517' || true)"
        );
        expect(cmd).toContain(
            "(git -C '/repo' branch -D 'fix/issue-2517' || true)"
        );
    });

    it("orders fetch/rebase < lane gate < push < merge < housekeeping", () => {
        const cmd = buildLockedCommand(base);
        const at = (needle: string) => {
            const i = cmd.indexOf(needle);
            expect(
                i,
                `expected to find "${needle}" in: ${cmd}`
            ).toBeGreaterThan(-1);
            return i;
        };
        expect(at(`git rebase ${ORIGIN_BASE}`)).toBeGreaterThan(
            at(`git fetch origin ${BASE_BRANCH}`)
        );
        expect(at("bun run check:lane")).toBeGreaterThan(
            at(`git rebase ${ORIGIN_BASE}`)
        );
        expect(at("git push --force-with-lease")).toBeGreaterThan(
            at("bun run check:lane")
        );
        expect(at("pr-merge.ts")).toBeGreaterThan(
            at("git push --force-with-lease")
        );
        expect(at("merge --ff-only")).toBeGreaterThan(at("pr-merge.ts"));
    });

    it("never runs the FULL gate inside the lock and never writes green-sha (ADR 0110 §3 → ADR 0136)", () => {
        // ADR 0110 ran `check:all` + `test` inside this lock: ~13 min of the
        // heavy mutex per landing, 1.4 contention false-REDs a day. The full
        // gate is not a landing's business at all — it runs per BATCH, and
        // the batch's own steps below are a ledger write and one detached
        // decision, nothing that holds the lock.
        const cmd = buildLockedCommand(base);
        expect(cmd).not.toContain("bun run check:all");
        expect(cmd).not.toContain("bun run test");
        expect(cmd).not.toContain("green-sha");
        // …and the health gate itself is never named here: what `land`
        // detaches is the DECISION, which fires `health-main.ts` only when a
        // threshold trips (ADR 0136 §6).
        expect(cmd).not.toContain("health-main.ts");
    });

    it("counts the landing in the batch-health ledger, past the merged-tip verification (ADR 0136 §6, issue #3780)", () => {
        // The full gate runs after the 5th landing since the last GREEN, or
        // 2 h after the first — so something must COUNT them, and the only
        // process that knows a landing happened is the one that merged it.
        const cmd = buildLockedCommand(base);
        const step = recordLandingStep("/repo");
        expect(cmd).toContain(step);
        // Relative, so it resolves in the PRIMARY checkout the `cd` entered —
        // never into the worktree this command is about to tear down.
        expect(step).toContain("bun 'scripts/health-cadence.ts' record --sha=");
        expect(step).not.toContain("/repo-issue-2517");
        // The tip recorded is the one the squash produced: read AFTER the
        // post-merge re-fetch and past the verification, never the tip the
        // remote held when `land` started.
        expect(step).toContain(`$(git rev-parse ${ORIGIN_BASE})`);
        expect(cmd.indexOf(step)).toBeGreaterThan(
            cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}" | wc -l`)
        );
        // In the PRIMARY checkout, where `.claude/telemetry/health/` lives.
        expect(step.startsWith("(cd '/repo' && ")).toBe(true);
        // Non-gating, like the rest of the post-merge housekeeping.
        expect(step.endsWith("; true)")).toBe(true);
    });

    it("syncs Grammar/Bot Gap issues post-merge, beside the preset-scenario seeding, non-gating (ADR 0137, issue #3829)", () => {
        const cmd = buildLockedCommand(base);
        const step = gapsSyncStep("/repo");
        expect(cmd).toContain(step);
        expect(step).toMatch(/bun '[^']*gaps-sync\.ts'/);
        expect(step.startsWith("(cd '/repo' && ")).toBe(true);
        // Non-gating: a `gh` outage must never turn a merged PR into a
        // reported failure.
        expect(step.endsWith("; true)")).toBe(true);
        expect(step).toContain(
            'echo "land: gaps:sync failed — Grammar/Bot Gap issues may be stale" >&2'
        );
        // Beside the preset-scenario seeding — AFTER it, same as the issue
        // body says ("beside the preset-scenario seeding it already does").
        const seedIdx = cmd.indexOf("seed-scenario.ts");
        const gapsIdx = cmd.indexOf("gaps-sync.ts");
        expect(gapsIdx).toBeGreaterThan(seedIdx);
        // Past the merged-tip verification too, like the rest of the housekeeping.
        expect(gapsIdx).toBeGreaterThan(
            cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}`)
        );
    });

    it("passes the origin band to gaps:sync when the landed issue's band is known (issue #4158)", () => {
        const cmd = buildLockedCommand({ ...base, originBand: "P0" });
        const step = gapsSyncStep("/repo", "P0");
        expect(cmd).toContain(step);
        expect(step).toMatch(/gaps-sync\.ts' --band P0 \|\|/);
        // Still non-gating, still in the primary checkout.
        expect(step.startsWith("(cd '/repo' && ")).toBe(true);
        expect(step.endsWith("; true)")).toBe(true);
    });

    it("passes no --band when it could not be determined: gaps:sync keeps its computed band (issue #4158)", () => {
        expect(gapsSyncStep("/repo")).not.toContain("--band");
        expect(gapsSyncStep("/repo", null)).not.toContain("--band");
        expect(buildLockedCommand({ ...base, originBand: null })).not.toContain(
            "--band"
        );
        expect(buildLockedCommand(base)).not.toContain("--band");
    });

    it("originBandForBranch: the band of the issue the branch names, by queue:plan's own rule (issue #4158)", () => {
        const board = { 4099: "P0", 4200: "P2", 4300: "P3" } as const;
        const deps = (parents: Record<number, number | null>) => ({
            readParent: (n: number) => parents[n] ?? null,
            readBoard: () => ({ ...board }),
        });
        // Own priority.
        expect(
            originBandForBranch("feat/issue-4200", deps({ 4200: null })).band
        ).toBe("P2");
        // Inherited from the parent PRD — the grammar-rule shape: the issue
        // carries no Priority of its own, its umbrella is P0.
        expect(
            originBandForBranch("feat/issue-4128", deps({ 4128: 4099 })).band
        ).toBe("P0");
        // The stronger wins, never the parent unconditionally.
        expect(
            originBandForBranch("fix/issue-4200", deps({ 4200: 4099 })).band
        ).toBe("P0");
        expect(
            originBandForBranch("fix/issue-4099", deps({ 4099: 4300 })).band
        ).toBe("P0");
    });

    it("originBandForBranch: never throws — a branch naming no issue, an unprioritised issue and an unreadable board are a null band plus a reason (issue #4158)", () => {
        const ok = { readParent: () => null, readBoard: () => ({}) };
        const noIssue = originBandForBranch("main", ok);
        expect(noIssue.band).toBeNull();
        expect(noIssue.reason).toMatch(/names no issue/);
        const unranked = originBandForBranch("feat/issue-1", ok);
        expect(unranked.band).toBeNull();
        expect(unranked.reason).toMatch(/carry no board Priority/);
        const boardDown = originBandForBranch("feat/issue-1", {
            readParent: () => null,
            readBoard: () => {
                throw new Error("rate limited");
            },
        });
        expect(boardDown.band).toBeNull();
        expect(boardDown.reason).toMatch(/board Priority \(rate limited\)/);
        const parentDown = originBandForBranch("feat/issue-1", {
            readParent: () => {
                throw new Error("gh exploded");
            },
            readBoard: () => ({}),
        });
        expect(parentDown.band).toBeNull();
        expect(parentDown.reason).toMatch(/parent of issue #1 \(gh exploded\)/);
    });

    it("does not sync gaps without a merge (--no-merge gates and pushes only)", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).not.toContain("gaps-sync.ts");
    });

    it("syncs gaps even under --keep — teardown is about the worktree, not the sync", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain("gaps-sync.ts");
    });

    it("starts the batch-health decision LAST, through `spawn` and never by backgrounding it", () => {
        const cmd = buildLockedCommand(base);
        const step = healthDetachStep("/repo");
        expect(cmd).toContain(step);
        expect(step).toContain("health-cadence.ts' spawn");
        // NOT `nohup … &`, and this is the whole point (issue #3780 review,
        // finding 1). `gate.ts` runs this locked command `detached`, so the
        // `sh` around it leads its own process group, and EVERY teardown path
        // — the ordinary exit handler after a clean child exit included —
        // SIGKILLs that group (issue #3821). `nohup` does not leave the
        // process group and neither does `&`, so a decision backgrounded here
        // dies milliseconds later while `land` reports a green landing: a
        // feature that looks installed and does nothing. `spawn` re-launches
        // it through `setsid(2)`, into a session no group signal can reach.
        // The topology itself is proven in `health-cadence-spawn.test.ts`.
        expect(step).not.toContain("nohup");
        expect(step).not.toContain("&)");
        // BEFORE the teardown, which removes the worktree this command runs
        // from. `land` invoked the driver by an ABSOLUTE path into that
        // worktree and ran the step AFTER `worktree remove`, so the first real
        // landing printed `Module not found …/tolaria-issue-3780/scripts/health-cadence.ts`
        // and started nothing. Both halves are asserted: the path is relative
        // to the primary checkout (the `cd` above puts us there), and the step
        // runs while the worktree still exists.
        expect(step).toContain("bun 'scripts/health-cadence.ts' spawn");
        expect(step).not.toContain("/repo-issue-2517");
        expect(cmd.indexOf(step)).toBeLessThan(cmd.indexOf("worktree remove"));
        // Non-gating: the PR is already merged.
        expect(step.endsWith("; true)")).toBe(true);
        expect(step.startsWith("(cd '/repo' && ")).toBe(true);
    });

    it("--keep still counts and still starts the decision — the batch is about the BASE branch, not the worktree", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain(recordLandingStep("/repo"));
        expect(cmd).toContain(healthDetachStep("/repo"));
    });

    it("--no-merge gates and pushes but omits the merge and the health detach", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).toContain("bun run check:lane");
        expect(cmd).toContain("git push --force-with-lease");
        expect(cmd).not.toContain("pr-merge.ts");
        expect(cmd).not.toContain("worktree remove");
        expect(cmd).not.toContain("merge --ff-only");
        // Nothing landed, so nothing to count and nothing to gate.
        expect(cmd).not.toContain("health-cadence.ts");
    });

    it("--keep merges but skips worktree teardown", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toMatch(/bun '[^']*pr-merge\.ts' 2517/);
        expect(cmd).toContain(`$OLD_TIP..${ORIGIN_BASE}`);
        expect(cmd).not.toContain("worktree remove");
    });

    it("fast-forwards the primary checkout's local main onto the merged tip, past the green-sha write", () => {
        // The API merge moves `origin/main` only; without this step the
        // checkout every session branches from sits one commit behind after a
        // green land, and the next `git worktree add` starts from a stale tip.
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain(primaryBranchFastForwardStep("/repo"));
        expect(cmd.indexOf("merge --ff-only")).toBeGreaterThan(
            cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}`)
        );
    });

    it("guards the fast-forward on the primary checkout actually being on main", () => {
        // Unguarded, `merge --ff-only origin/main` would fast-forward whatever
        // OTHER branch is checked out there — silently moving a user's
        // work-in-progress branch. The guard is the whole safety of the step.
        const step = primaryBranchFastForwardStep("/repo");
        expect(step).toContain(
            `[ "$(git -C '/repo' symbolic-ref --quiet --short HEAD)" = "${BASE_BRANCH}" ]`
        );
        expect(step).toContain(
            `git -C '/repo' merge --ff-only -q ${ORIGIN_BASE}`
        );
        // The same step serves `release` for the release branch.
        expect(primaryBranchFastForwardStep("/repo", RELEASE_BRANCH)).toContain(
            `merge --ff-only -q origin/${RELEASE_BRANCH}`
        );
        // Non-gating: a dirty tree in the primary checkout must not turn a
        // MERGED PR into a reported failure.
        expect(step.endsWith("; true)")).toBe(true);
    });

    it("--keep still fast-forwards local main (teardown is about the WORKTREE)", () => {
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).toContain("merge --ff-only");
    });

    it("--no-merge never touches local main — nothing landed to catch up with", () => {
        const cmd = buildLockedCommand({ ...base, merge: false });
        expect(cmd).not.toContain("merge --ff-only");
    });

    it("releases the in-progress claim on the issue the branch names, past the merge, non-gating (issue #3130)", () => {
        // The claim is added at pick time; before this step nothing removed
        // it on the success path (claim-sweep runs at SessionEnd and leaves a
        // claim whose PR is open; loop:doctor sweeps OPEN issues only), so an
        // issue closed by its PR kept `in-progress` forever — 56 of them.
        const cmd = buildLockedCommand(base);
        const step = releaseClaimStep("fix/issue-2517");
        expect(step).not.toBeNull();
        expect(cmd).toContain(step!);
        expect(step).toContain("gh issue edit 2517 --remove-label in-progress");
        expect(cmd.indexOf(step!)).toBeGreaterThan(cmd.indexOf("pr-merge.ts"));
        // Non-gating: wrapped so a failed label edit cannot fail the landing.
        expect(step!.endsWith("; true)")).toBe(true);
        // And never without a merge — the claim is still live then.
        expect(buildLockedCommand({ ...base, merge: false })).not.toContain(
            "--remove-label in-progress"
        );
    });

    it("names no issue for a branch outside the issue-N convention, and adds no step", () => {
        expect(issueOfBranch("feat/issue-3130")).toBe(3130);
        expect(issueOfBranch("fix/issue-7")).toBe(7);
        expect(issueOfBranch("docs/adr-0116")).toBeNull();
        expect(issueOfBranch("issue-12-and-more")).toBeNull();
        expect(releaseClaimStep("docs/adr-0116")).toBeNull();
        expect(
            buildLockedCommand({ ...base, branch: "docs/adr-0116" })
        ).not.toContain("--remove-label in-progress");
    });

    it("--keep leaves the REMOTE branch alone too, not just the worktree (#2536)", () => {
        // `--keep` exists so the worktree survives the landing; deleting its
        // upstream leaves that worktree with no remote to push to. Teardown
        // is ONE decision and `--keep` opts out of all of it.
        const cmd = buildLockedCommand({ ...base, teardown: false });
        expect(cmd).not.toContain("git push origin --delete");
    });

    it("runs the post-merge housekeeping in the PRIMARY checkout, never the worktree", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd).toContain("cd '/repo' && bun");
        expect(cmd).not.toContain("cd '/repo-issue-2517'");
    });

    it("re-fetches the base branch AFTER the merge, before verifying the tip", () => {
        const cmd = buildLockedCommand(base);
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        const refetchIdx = cmd.indexOf(`git fetch origin ${BASE_BRANCH} -q`);
        const verifyIdx = cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}`);
        expect(refetchIdx).toBeGreaterThan(mergeIdx);
        expect(verifyIdx).toBeGreaterThan(refetchIdx);
    });

    it("captures the pre-merge tip and verifies the merged tip before any housekeeping (review round 2, F5)", () => {
        // The gate mutex is machine-wide only — it says nothing about a push
        // landing from elsewhere while this session held it. `land` must
        // prove the base tip advanced by exactly its own squash before it
        // runs the post-merge housekeeping on it.
        const cmd = buildLockedCommand(base);
        const oldTipIdx = cmd.indexOf(
            `OLD_TIP=$(git rev-parse ${ORIGIN_BASE})`
        );
        const mergeIdx = cmd.indexOf("pr-merge.ts");
        const refetchIdx = cmd.indexOf(`git fetch origin ${BASE_BRANCH} -q`);
        const verifyIdx = cmd.indexOf(`$OLD_TIP..${ORIGIN_BASE}" | wc -l`);
        const ffIdx = cmd.indexOf("merge --ff-only");

        expect(oldTipIdx).toBeGreaterThan(-1);
        expect(mergeIdx).toBeGreaterThan(oldTipIdx);
        expect(refetchIdx).toBeGreaterThan(mergeIdx);
        expect(verifyIdx).toBeGreaterThan(refetchIdx);
        expect(ffIdx).toBeGreaterThan(verifyIdx);

        // A failed verification must exit before any housekeeping runs.
        expect(cmd).toContain("refusing post-merge housekeeping");
    });

    it("unsets GITHUB_TOKEN as the very first thing the locked shell does (review round 3, B1)", () => {
        const cmd = buildLockedCommand(base);
        expect(cmd.split(" && ")[0]).toBe("unset GITHUB_TOKEN");
        expect(cmd.indexOf("unset GITHUB_TOKEN")).toBeLessThan(
            cmd.indexOf("pr-merge.ts")
        );
    });

    it("the unset actually clears GITHUB_TOKEN for anything the locked shell runs — closing the bun .env.local re-injection gap, not just a string position (review round 3, B1)", () => {
        // `lockedEnv()` strips GITHUB_TOKEN from what land.ts hands to
        // spawnSync("bun", [GATE, …]) — but that child is `bun scripts/gate.ts`,
        // and bun auto-loads `.env.local` from ITS OWN cwd back into its own
        // process.env (the worktree carries the server-side bug-report PAT),
        // which gate.ts then spreads onto the `sh -c` child that runs the
        // embedded merge (`pr-merge.ts`). `sh` never reads `.env.local`, so `unset`
        // baked into the emitted command string is the one point left that
        // can remove a re-injected token. Extract the EXACT first step
        // `buildLockedCommand` produces (not a hand-written stand-in) and run
        // it through a real shell with GITHUB_TOKEN seeded exactly as the
        // re-injection would leave it.
        const firstStep = buildLockedCommand(base).split(" && ")[0];
        const r = spawnSync(
            "sh",
            ["-c", `${firstStep} && echo "TOKEN=[$GITHUB_TOKEN]"`],
            {
                encoding: "utf8",
                env: { ...process.env, GITHUB_TOKEN: "github_pat_leaked" },
            }
        );
        expect(r.stdout).toContain("TOKEN=[]");
    });

    it("an earlier step's failure (e.g. the lane gate going red) exits on its own status, never laundered into the concurrency-refusal message (review round 3)", () => {
        // `&&`/`||` are equal-precedence and left-associative: splicing
        // VERIFY_MERGED_TIP bare into the `&&` chain let a failure anywhere
        // EARLIER cascade past every `&&`-joined step and trip its `||`
        // anyway, misreporting a red gate as "refusing to record green-sha".
        // Reproduces the reviewer's exact repro (an earlier step failing)
        // without touching real git/gh: stand `rebaseStep()` in for a no-op
        // (it would otherwise hit the real network) and force the next step
        // to fail — everything after must then be skipped by `&&`
        // short-circuit, the merge step and the rest included.
        const cmd = buildLockedCommand(base)
            .replace(rebaseStep(), "true")
            .replace("bun run check:lane", "false");
        const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
        expect(r.status).toBe(1);
        expect(r.stderr).not.toContain("refusing to record green-sha");
    });

    it("is syntactically valid shell", () => {
        for (const opts of [
            base,
            { ...base, merge: false },
            { ...base, teardown: false },
        ]) {
            const cmd = buildLockedCommand(opts);
            const r = spawnSync("sh", ["-n", "-c", cmd], { encoding: "utf8" });
            expect(r.status, r.stderr).toBe(0);
        }
    });

    // Proof-of-failure: changed `if (opts.merge)` to `if (true)` (so
    // `--no-merge` no longer omitted the merge step) — "--no-merge gates and
    // pushes but omits the merge" went red (cmd still contained the merge
    // step). Reverted.
    //
    // Proof-of-failure (#2536): moved the remote-ref delete back OUTSIDE the
    // `if (opts.teardown)` block — "--keep leaves the REMOTE branch alone
    // too" went red. Reverted.
});

describe("land.ts — lockedEnv (review round 2, B1)", () => {
    it("declares the caller's ROLE, which is what makes a queued land visible to the mutex's yield rule (ADR 0136 §6)", () => {
        // The batch health gate steps aside while any `land` is queued. A
        // waiter is only recognisable as a landing because of this variable —
        // without it health overtakes every queue and each landing pays the
        // ten minutes the yield rule exists to save it.
        expect(lockedEnv({}).TOLARIA_GATE_ROLE).toBe("land");
    });

    // bun auto-loads `.env.local`, which in this repo carries a server-side
    // bug-report `GITHUB_TOKEN` that `gh` prefers over the keyring login.
    // Inherited by the locked child that runs the embedded `gh pr merge`,
    // that PAT lacks merge permission and the merge 403s AFTER check:all +
    // test have already run inside the lock. `lockedEnv` is a NECESSARY but
    // NOT SUFFICIENT part of the fix — a pure function of a base env so this
    // test never touches real process.env. It is insufficient by itself
    // because the child it strips the token FOR is `bun scripts/gate.ts`,
    // which auto-loads `.env.local` from its OWN cwd and re-injects the
    // token into its OWN process.env regardless of what `lockedEnv` passed
    // in — these tests catch a regression in the env transform, but the
    // actual leak this env transform cannot reach is covered by the
    // command-string / real-shell tests above (review round 3, B1).
    const base: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        GITHUB_TOKEN: "github_pat_bug-report-token",
        GH_TOKEN: "gho_keyring-token",
    };

    it("strips GITHUB_TOKEN", () => {
        expect(lockedEnv(base).GITHUB_TOKEN).toBeUndefined();
    });

    it("leaves GH_TOKEN alone", () => {
        expect(lockedEnv(base).GH_TOKEN).toBe("gho_keyring-token");
    });

    it("preserves the rest of the base env and sets TOLARIA_ALLOW_FULL_SUITE", () => {
        const env = lockedEnv(base);
        expect(env.PATH).toBe("/usr/bin");
        expect(env.TOLARIA_ALLOW_FULL_SUITE).toBe("1");
    });
});

describe("land.ts — the lane is skipped on a (tip, base) already gated green (ADR 0136 §2, issue #3779)", () => {
    /**
     * `buildLockedCommand` takes the green records as an input
     * (`gatedGreen`); the comparison itself runs INSIDE the locked shell,
     * because the tip it compares is the one the rebase just produced. So the
     * lane step is executed here for real, in a scratch repo with an
     * `origin/<base>` ref, with `bun run check:lane` stood in for by a marker.
     */
    let repo: string;
    let runRoot: string;
    const git = (...args: string[]) =>
        spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    const sha = (ref: string) => git("rev-parse", ref).stdout.trim();
    const OTHER = "0123456789abcdef0123456789abcdef01234567";

    const runLane = (
        gatedGreen: { head: string; base: string }[],
        lane = "echo GATED",
        recordDir: string | null = null
    ) =>
        spawnSync(
            "sh",
            [
                "-c",
                laneStep(gatedGreen, recordDir).replace(
                    "bun run check:lane",
                    lane
                ),
            ],
            { cwd: repo, encoding: "utf8" }
        );

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), "tolaria-land-lane-"));
        runRoot = mkdtempSync(join(tmpdir(), "tolaria-land-runs-"));
        const commit = (msg: string) =>
            git(
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                msg
            );
        git("init", "-q");
        commit("base");
        git("update-ref", `refs/remotes/${ORIGIN_BASE}`, "HEAD");
        commit("rebased tip");
    });

    afterEach(() => {
        rmSync(repo, { recursive: true, force: true });
        rmSync(runRoot, { recursive: true, force: true });
    });

    it("is the lane step of the locked command, built from the green records it was given", () => {
        const gatedGreen = [{ head: "a".repeat(40), base: "b".repeat(40) }];
        const cmd = buildLockedCommand({
            branch: "fix/issue-3779",
            gatedGreen,
            laneRecordDir: "/runs/land-lane-3779",
            pr: 3779,
            primaryCheckout: "/repo",
            worktree: "/repo-issue-3779",
            merge: true,
            teardown: true,
        });
        expect(cmd).toContain(laneStep(gatedGreen, "/runs/land-lane-3779"));
    });

    it("skips the lane when the rebased tip AND the base tip match a green run", () => {
        const r = runLane([{ head: sha("HEAD"), base: sha(ORIGIN_BASE) }]);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain("GATED");
        expect(r.stdout).toContain(
            `lane: skipped (gated ${sha("HEAD")} against ${sha(ORIGIN_BASE)})`
        );
    });

    it("runs the lane when the tip matches but the base does not", () => {
        const r = runLane([{ head: sha("HEAD"), base: OTHER }]);
        expect(r.stdout).toContain("lane: ran");
        expect(r.stdout).toContain("GATED");
    });

    it("runs the lane when the base matches but the tip does not", () => {
        const r = runLane([{ head: OTHER, base: sha(ORIGIN_BASE) }]);
        expect(r.stdout).toContain("lane: ran");
        expect(r.stdout).toContain("GATED");
    });

    it("runs the lane when the tip and base each match a DIFFERENT run", () => {
        const r = runLane([
            { head: sha("HEAD"), base: OTHER },
            { head: OTHER, base: sha(ORIGIN_BASE) },
        ]);
        expect(r.stdout).toContain("GATED");
    });

    it("runs the lane with no green records at all", () => {
        const r = runLane([]);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("lane: ran");
        expect(r.stdout).toContain("GATED");
    });

    it("runs the lane on a dirty tree even when the shas match — the sha no longer names the tree", () => {
        writeFileSync(join(repo, "stray.txt"), "x");
        const r = runLane([{ head: sha("HEAD"), base: sha(ORIGIN_BASE) }]);
        expect(r.stdout).toContain("GATED");
    });

    it("a red lane fails the step and records nothing", () => {
        const dir = join(runRoot, "land-lane-1");
        const r = runLane([], "false", dir);
        expect(r.status).not.toBe(0);
        expect(readGreenLaneRuns(runRoot)).toEqual([]);
    });

    it("a green lane records its (tip, base), so a retried land of the same tree skips it", () => {
        const dir = join(runRoot, "land-lane-1");
        expect(runLane([], "true", dir).status).toBe(0);
        const recorded = readGreenLaneRuns(runRoot);
        expect(recorded).toEqual([
            { head: sha("HEAD"), base: sha(ORIGIN_BASE) },
        ]);
        const retry = runLane(recorded, "echo GATED", dir);
        expect(retry.stdout).toContain("lane: skipped");
        expect(retry.stdout).not.toContain("GATED");
    });

    it("counts only an exact green `check:lane` record with full shas", () => {
        const ok = {
            command: "check:lane\n",
            head: `${"a".repeat(40)}\n`,
            base: `${"b".repeat(40)}\n`,
            green: true,
        };
        expect(greenLaneRunOf(ok)).toEqual({
            head: "a".repeat(40),
            base: "b".repeat(40),
        });
        expect(greenLaneRunOf({ ...ok, green: false })).toBeNull();
        expect(greenLaneRunOf({ ...ok, command: "land 3779" })).toBeNull();
        expect(
            greenLaneRunOf({ ...ok, command: "check:lane --base=origin/x" })
        ).toBeNull();
        expect(greenLaneRunOf({ ...ok, base: "" })).toBeNull();
        expect(greenLaneRunOf({ ...ok, head: "a'; rm -rf / #" })).toBeNull();
    });

    it("reads gate-run.sh's root the way the script computes it", () => {
        expect(gateRunRoot({ TOLARIA_GATE_RUN_DIR: "/x" })).toBe("/x");
        expect(gateRunRoot({ XDG_CACHE_HOME: "/c", HOME: "/h" })).toBe(
            "/c/tolaria/gate-runs"
        );
        expect(gateRunRoot({ HOME: "/h" })).toBe("/h/.cache/tolaria/gate-runs");
    });
});

describe("land.ts — nested heavy gate inside the locked command", () => {
    let lockRoot: string;

    function gateEnv(extra: Record<string, string> = {}) {
        const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
        delete base.TOLARIA_GATE_HELD;
        delete base.TOLARIA_ALLOW_FULL_SUITE;
        delete base.TOLARIA_VITEST_WORKERS;
        return { ...base, ...extra };
    }

    beforeEach(() => {
        lockRoot = mkdtempSync(join(tmpdir(), "tolaria-land-gate-test-"));
    });

    afterEach(() => {
        rmSync(lockRoot, { recursive: true, force: true });
    });

    it("a heavy gate.ts call nested inside another (the shape `bun run check:all` takes inside land's locked command) passes straight through instead of blocking on itself", () => {
        // This is exactly the composition `buildLockedCommand` produces:
        // the OUTER `gate.ts heavy` (land's own invocation) wraps a shell
        // command whose steps (`bun run check:all`, `bun run test`) are
        // themselves `gate.ts heavy` calls. Reproduce that nesting directly.
        //
        // `timeout` is mandatory here (review round 2, medium): spawnSync
        // BLOCKS THE WORKER SYNCHRONOUSLY, so vitest's own test timeout
        // cannot preempt a hang — without a `timeout` a regression here
        // hangs `bun run test` instead of reddening it, which on a repo
        // whose green-main invariant is absolute is worse than a red.
        // `r.status` is the tell: a real passthrough finishes in well under
        // 100ms with status 0, while a blocked one is SIGTERMed by `timeout`
        // and gate.ts's own signal handler turns that into exit 130 — so
        // `r.signal` stays null and line 371 is the assertion that fires.
        // `expect(r.signal).toBeNull()` is kept as belt-and-braces for a
        // child that dies BEFORE installing that handler.
        const r = spawnSync(
            "bun",
            [GATE, "heavy", `bun ${GATE} heavy "echo NESTED-OK"`],
            { encoding: "utf8", cwd: lockRoot, env: gateEnv(), timeout: 15_000 }
        );
        expect(r.signal).toBeNull();
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(r.stdout).toContain("NESTED-OK");
    }, 20_000);

    // This test proves passthrough (TOLARIA_GATE_HELD present → no wait), not
    // the absence of deadlock — proving a negative needs the failure mode to
    // actually occur under a bound. The test below is that: it reproduces the
    // deadlock committed, on a bounded timeout, rather than resting on a
    // manual probe recorded only in prose (review round 2 caveat).
    it("a heavy call that does NOT inherit TOLARIA_GATE_HELD deadlocks against a lock its own ancestor holds", () => {
        // Pre-seed the lock exactly as a live heavy holder would: owner.json
        // naming a pid that IS alive (this test process's own — `alive()` in
        // gate.ts checks `process.kill(pid, 0)`, which succeeds for our own
        // pid) and a fresh timestamp (nowhere near STALE_MS). Then spawn a
        // heavy call against that SAME lock root from a neutral cwd with
        // TOLARIA_GATE_HELD stripped — the exact situation land.ts's design
        // exists to avoid: a heavy call that does not know it is nested.
        mkdirSync(join(lockRoot, "gate.lock"), { recursive: true });
        writeFileSync(
            join(lockRoot, "gate.lock", "owner.json"),
            JSON.stringify({
                pid: process.pid,
                label: "simulated live holder",
                cwd: lockRoot,
                ts: Date.now(),
            })
        );

        const env = gateEnv();
        delete env.TOLARIA_GATE_HELD;

        const r = spawnSync("bun", [GATE, "heavy", "echo SHOULD-NOT-RUN"], {
            encoding: "utf8",
            cwd: lockRoot,
            env,
            timeout: 3000,
        });

        // spawnSync's `timeout` SIGTERMs the child when it fires and never
        // sets a normal exit `status` — that is the proof the process was
        // still blocked in acquire()'s poll loop, not merely slow: a
        // passthrough call (see the test above) returns in well under 100ms.
        expect(r.signal).toBe("SIGTERM");
        expect(r.stdout).not.toContain("SHOULD-NOT-RUN");
    }, 8000);

    // Proof-of-failure: temporarily deleted the `TOLARIA_GATE_HELD:
    // tier === "heavy" ? "1" : …` line in gate.ts's `env` object (main()),
    // so a nested heavy call would never see the flag its own parent had.
    // The FIRST test above ("passes straight through") then goes RED at
    // ~15s: the inner call blocks in acquire()'s poll loop, spawnSync's
    // `timeout: 15_000` SIGTERMs it, gate.ts's signal handler exits 130,
    // and line 371 fails on `r.status`. vitest completes normally
    // (1 failed, exit 1). Reverted.
    //
    // Why the bound is load-proof: the happy path returns in <100ms, three
    // orders of magnitude inside 15s, and the bound sits under the test's
    // own 20s vitest timeout so spawnSync always fires first and leaves
    // room to report.
    //
    // Run WITHOUT that `timeout` (the round-2 shape), the same mutation did
    // not redden at all — it hung: spawnSync blocks the worker
    // synchronously, so vitest's timeout could not preempt it and
    // `bun run test` had to be force-stopped. That is the regression the
    // bound exists to convert into a failing assertion.
});

describe("land.ts — rebase conflict (real git, no remote/no lock)", () => {
    let dir: string;
    let origin: string;
    let clone: string;

    function run(args: string[], cwd: string) {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-test-"));
        origin = join(dir, "origin.git");
        clone = join(dir, "clone");

        run(["init", "--bare", "-b", BASE_BRANCH, origin], dir);
        run(["clone", origin, clone], dir);
        run(["config", "user.email", "test@example.com"], clone);
        run(["config", "user.name", "Test"], clone);

        writeFileSync(join(clone, "shared.txt"), "base\n");
        run(["add", "shared.txt"], clone);
        run(["commit", "-m", "base"], clone);
        run(["push", "origin", BASE_BRANCH], clone);

        // Feature branch diverges from main...
        run(["checkout", "-b", "feature"], clone);
        writeFileSync(join(clone, "shared.txt"), "feature change\n");
        run(["commit", "-am", "feature edit"], clone);

        // ...and main moves under it, touching the same line.
        run(["checkout", BASE_BRANCH], clone);
        writeFileSync(join(clone, "shared.txt"), "main change\n");
        run(["commit", "-am", "main edit"], clone);
        run(["push", "origin", BASE_BRANCH], clone);
        run(["checkout", "feature"], clone);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("aborts the rebase, exits non-zero, and names the conflicting path", () => {
        const r = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status).not.toBe(0);
        expect(r.stdout).toContain("shared.txt");

        // The tree must be left usable — no rebase in progress, still on the
        // feature branch (a real `--abort`, not just a nonzero exit).
        const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
            cwd: clone,
            encoding: "utf8",
        }).stdout.trim();
        expect(existsSync(join(clone, gitDir, "rebase-merge"))).toBe(false);
        expect(existsSync(join(clone, gitDir, "rebase-apply"))).toBe(false);
        const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: clone,
            encoding: "utf8",
        }).stdout.trim();
        expect(branch).toBe("feature");
    });

    it("does nothing destructive when there is no conflict", () => {
        // A branch that never touches shared.txt rebases cleanly even though
        // main has moved — this is the common case `land` runs through on
        // every landing, and it must not be treated as a conflict.
        run(["checkout", "-b", "peaceful", BASE_BRANCH], clone);
        writeFileSync(join(clone, "peaceful.txt"), "peaceful change\n");
        run(["add", "peaceful.txt"], clone);
        run(["commit", "-m", "peaceful edit"], clone);

        run(["checkout", BASE_BRANCH], clone);
        writeFileSync(join(clone, "unrelated.txt"), "new file\n");
        run(["add", "unrelated.txt"], clone);
        run(["commit", "-m", "unrelated"], clone);
        run(["push", "origin", BASE_BRANCH], clone);
        run(["checkout", "peaceful"], clone);

        const r = spawnSync("sh", ["-c", rebaseStep()], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status, r.stdout + r.stderr).toBe(0);
    });

    // Proof-of-failure: removed the `git rebase --abort` call from
    // `rebaseStep` (kept only the diff + `exit 1`) — the "no rebase in
    // progress" assertions went red (both `rebase-merge`/`rebase-apply`
    // existed under .git/, and HEAD read `feature` only nominally while a
    // rebase was still active) — the test caught the tree being left
    // unusable. Reverted.
});

describe("land.ts — remoteBranchDeleteStep (issue #2877: no error: noise on an already-gone branch, real git)", () => {
    // A string match on the shell fragment cannot tell "filters the right
    // diagnostic" from "filters nothing" — only running it against a real
    // git remote that has already had the branch deleted (exactly what
    // GitHub's "Automatically delete head branches" does before `land`'s own
    // teardown runs) proves the stderr is actually gone.
    let dir: string;
    let origin: string;
    let clone: string;

    function run(args: string[], cwd: string) {
        const r = spawnSync("git", args, { cwd, encoding: "utf8" });
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
        }
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-delete-test-"));
        origin = join(dir, "origin.git");
        clone = join(dir, "clone");

        run(["init", "--bare", "-b", BASE_BRANCH, origin], dir);
        run(["clone", origin, clone], dir);
        run(["config", "user.email", "test@example.com"], clone);
        run(["config", "user.name", "Test"], clone);

        writeFileSync(join(clone, "base.txt"), "base\n");
        run(["add", "base.txt"], clone);
        run(["commit", "-m", "base"], clone);
        run(["push", "origin", BASE_BRANCH], clone);

        run(["checkout", "-b", "feature"], clone);
        writeFileSync(join(clone, "feature.txt"), "feature\n");
        run(["add", "feature.txt"], clone);
        run(["commit", "-m", "feature"], clone);
        run(["push", "origin", "feature"], clone);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    // Proof-of-failure (issue #2877): swap the `sh -c` argument below for
    // the OLD unfiltered wrapper `(git push origin --delete 'feature' ||
    // true)` and this test goes red — `stderr` contains
    // "error: unable to delete 'feature': remote ref does not exist" even
    // though the branch really is already gone (confirmed by hand:
    // `git push origin --delete` on a ref the bare remote no longer has
    // prints exactly that plus "error: failed to push some refs to …", exit
    // 1, on real git — reproduced before writing this fixture).
    it("prints nothing when the remote branch is already gone (GitHub's auto-delete beat us to it)", () => {
        // Simulate GitHub having already deleted the head branch on merge —
        // the ref is gone from the remote, but the local clone (standing in
        // for `land`'s worktree, mid-teardown) still has a local branch and
        // upstream to push a delete to.
        run(["update-ref", "-d", "refs/heads/feature"], origin);

        const r = spawnSync("sh", ["-c", remoteBranchDeleteStep("feature")], {
            cwd: clone,
            encoding: "utf8",
        });
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
    });

    it("still surfaces a delete that fails for a real reason, not just an absent ref", () => {
        // An unreachable remote stands in for "the delete genuinely failed"
        // — whatever the real-world cause (permissions, a lock, …), git's
        // own text will not read "remote ref does not exist", and that
        // phrase is the only thing the diagnostic filter trusts.
        run(
            ["remote", "set-url", "origin", join(dir, "nonexistent.git")],
            clone
        );

        const r = spawnSync("sh", ["-c", remoteBranchDeleteStep("feature")], {
            cwd: clone,
            encoding: "utf8",
        });
        // Still non-gating — a real ref-cleanup failure still can't fail a
        // landing whose merge already succeeded.
        expect(r.status).toBe(0);
        expect(r.stderr.length).toBeGreaterThan(0);
        expect(r.stderr).not.toContain("remote ref does not exist");
    });
});

describe("land.ts — computeSkinReceiptInvalid (issue #2760 review, finding 3)", () => {
    // The PR that introduced this function claimed it was "tested directly"
    // — it was not: `grep -rn computeSkinReceiptInvalid scripts/` returned
    // only the definition and its one call site. Deleting the
    // `lane === "skin" &&` guard left the receipt check firing on every
    // lane, which would make `land` refuse EVERY engine/full landing (the
    // merge-train dies). These tests exercise the function directly, per
    // this file's own convention.

    it("is false for a non-skin lane, regardless of the receipt body", () => {
        expect(
            computeSkinReceiptInvalid("engine", "garbage, not a receipt")
        ).toBe(false);
        expect(
            computeSkinReceiptInvalid("full", "garbage, not a receipt")
        ).toBe(false);
    });

    it("is true for a skin lane whose receipt is garbage/invalid", () => {
        expect(
            computeSkinReceiptInvalid("skin", "garbage, not a receipt")
        ).toBe(true);
    });

    it("is false for a skin lane whose receipt actually verifies clean", () => {
        // A REAL full walk over the real surface table and viewport matrix,
        // every Floor at zero, rendered through the real functions exactly as
        // `check:ui` would — under `verifyReceiptText`'s defaults, which
        // `computeSkinReceiptInvalid` uses.
        expect(
            computeSkinReceiptInvalid(
                "skin",
                `Closes #2760\n\n${laneReceipt(null)}`
            )
        ).toBe(false);
    });

    it("refuses a skin PR whose receipt carries a FAIL line (ADR 0132 §6)", () => {
        const [first] = SURFACE_IDS.filter(
            (id) => !UNWALKED_SURFACES.some((u) => u.surface === id)
        );
        const body = laneReceipt(null, {
            at: (surface, viewport) =>
                surface === first && viewport === VIEWPORT_IDS[1]
                    ? { ...zeroReadings(), cardsZero: 1 }
                    : undefined,
        });
        expect(body).toMatch(/^FAIL {5}/m);
        expect(computeSkinReceiptInvalid("skin", body)).toBe(true);
    });

    it("accepts a receipt whose diagnostic block differs from a re-run — land never reads it", () => {
        const run1 = laneReceipt(null, {
            at: () => ({ ...zeroReadings(), cardsOcc: 1, small: 24 }),
            facts: ["machine load: start 3.1, end 4.0", "wall time: 212s"],
        });
        const run2 = laneReceipt(null, {
            at: () => ({ ...zeroReadings(), cardsOcc: 5, starved: 2 }),
            facts: ["machine load: start 19.7, end 22.3", "wall time: 388s"],
        });
        expect(run1).not.toBe(run2);
        expect(computeSkinReceiptInvalid("skin", run1)).toBe(false);
        expect(computeSkinReceiptInvalid("skin", run2)).toBe(false);
    });

    // Proof-of-failure (not a permanent test): deleted the
    // `lane === "skin" &&` guard in `computeSkinReceiptInvalid` — "is false
    // for a non-skin lane…" went red (`true` instead of `false` for both
    // "engine" and "full", on garbage input that always fails
    // `verifyReceiptText`). Reverted after confirming red; recorded in the
    // PR receipt's `proofOfFailure` list.
});

describe("land.ts — a skin PR's SCOPED receipt must match the scope of its own diff (issue #3628)", () => {
    // Real surfaces, real viewport matrix, real import graph of this tree: the scope
    // is derived from a diff exactly as `land` derives it, never hand-written.
    const REPO_ROOT = resolve(__dirname, "..", "..");
    const DETAIL_DIFF = ["src/routes/deck-detail.route.tsx"];
    const LOBBY_DIFF = ["src/routes/lobby.route.tsx"];

    const receiptBody = (surfaces: readonly string[] | null) =>
        laneReceipt(surfaces);

    function scopedSurfaces(diff: string[]): string[] {
        const scope = landingDiffScope(diff, REPO_ROOT);
        if (scope.kind !== "scoped") {
            throw new Error(
                `expected a scoped diff, got FULL: ${scope.reason}`
            );
        }
        return scope.surfaces;
    }

    it("accepts the SCOPED receipt of its own diff, and refuses it for a diff reaching other surfaces", () => {
        const detail = scopedSurfaces(DETAIL_DIFF);
        const lobby = scopedSurfaces(LOBBY_DIFF);
        expect(detail.length).toBeGreaterThan(0);
        expect(detail).not.toEqual(lobby);

        const body = receiptBody(detail);
        expect(body).toContain(`SCOPED — diff base ${ORIGIN_BASE}`);
        expect(skinReceiptInvalidForDiff(DETAIL_DIFF, REPO_ROOT, body)).toBe(
            false
        );
        expect(skinReceiptInvalidForDiff(LOBBY_DIFF, REPO_ROOT, body)).toBe(
            true
        );
    });

    it("refuses a SCOPED receipt for a skin diff that also forces the full run", () => {
        const body = receiptBody(scopedSurfaces(DETAIL_DIFF));
        expect(
            skinReceiptInvalidForDiff(
                ["src/index.css", ...DETAIL_DIFF],
                REPO_ROOT,
                body
            )
        ).toBe(true);
    });

    it("demands the full RECEIPT when the scope cannot be derived — never 'no receipt owed'", () => {
        const throwing = () => {
            throw new Error("import graph unreadable");
        };
        const scopedBody = receiptBody(scopedSurfaces(DETAIL_DIFF));
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                scopedBody,
                throwing
            )
        ).toBe(true);
        expect(
            skinReceiptInvalidForDiff(
                DETAIL_DIFF,
                REPO_ROOT,
                receiptBody(null),
                throwing
            )
        ).toBe(false);
    });

    it("accepts a full RECEIPT for a diff the scoper narrows", () => {
        expect(
            skinReceiptInvalidForDiff(DETAIL_DIFF, REPO_ROOT, receiptBody(null))
        ).toBe(false);
    });
});

describe("land.ts — safeSkinReceiptInvalid tolerates a diff-classification failure (issue #2760 review, finding 6)", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tolaria-land-safe-test-"));
        const r = spawnSync("git", ["init", "-q", "-b", "main", dir], {
            encoding: "utf8",
        });
        if (r.status !== 0) {
            throw new Error(`git init failed: ${r.stderr}`);
        }
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns false instead of throwing when origin/main does not exist (no remote at all)", () => {
        // `changedPaths` shells out to `git diff … origin/main...HEAD` —
        // with no remote configured at all, that is an unresolvable
        // revision and `check-lane.ts`'s `git()` throws. This used to run
        // BEFORE any of `land`'s refusal checks, on every lane.
        expect(() =>
            safeSkinReceiptInvalid(dir, "irrelevant body")
        ).not.toThrow();
        expect(safeSkinReceiptInvalid(dir, "irrelevant body")).toBe(false);
    });

    // Proof-of-failure (not a permanent test): removed the try/catch from
    // `safeSkinReceiptInvalid` (called `classifyLane(changedPaths(...))`
    // directly, unguarded) — the test above went red with an UNCAUGHT
    // exception ("git diff … failed: fatal: ambiguous argument
    // 'origin/main...HEAD': unknown revision…") instead of returning `false`
    // cleanly. Reverted after confirming red; recorded in the PR receipt's
    // `proofOfFailure` list.
});

describe("land.ts — isTestOnlySrcDiff (ADR 0110 §4)", () => {
    // A src/** diff made only of test files cannot reach the DOM, so it owes
    // no check:ui receipt. The incident: a one-line test-constant green-main
    // repair (2026-08-27) was refused over a receipt for a diff with no
    // rendered surface.
    it("is true for a diff whose only src files are tests", () => {
        expect(isTestOnlySrcDiff(["src/__tests__/design-tokens.test.ts"])).toBe(
            true
        );
        expect(
            isTestOnlySrcDiff([
                "src/lib/__tests__/card-utils.test.ts",
                "src/components/board/Stack.test.tsx",
                "scripts/land.ts",
            ])
        ).toBe(true);
    });

    it("is false as soon as ONE non-test src file is in the diff", () => {
        expect(
            isTestOnlySrcDiff([
                "src/__tests__/design-tokens.test.ts",
                "src/components/board/Stack.tsx",
            ])
        ).toBe(false);
    });

    it("is false for a diff with no src files at all (not this exemption's business)", () => {
        expect(isTestOnlySrcDiff(["convex/gre/stack.ts"])).toBe(false);
        expect(isTestOnlySrcDiff([])).toBe(false);
    });

    it("does not treat a non-test file under a test-ish name as a test", () => {
        // `contest.ts` / `latest.tsx` must not match a sloppy substring
        // check — the regex anchors on `.test.` and `__tests__/`.
        expect(isTestOnlySrcDiff(["src/lib/contest.ts"])).toBe(false);
        expect(isTestOnlySrcDiff(["src/lib/latest.tsx"])).toBe(false);
    });
});

describe("land.ts — a cards-lane landing is treated like engine (ADR 0136 §4, issue #3778)", () => {
    // The two lane-aware decisions `land` makes are the `check:ui` receipt
    // (skin only) and the preset-scenario refusal (path-based, ADR 0044). A
    // card PR used to classify `engine`; it now classifies `cards`, and
    // neither decision may change with it: no receipt owed, scenario owed.
    const CARD_DIFF = [
        "convex/cards/sets/lea/red.ts",
        "data/card-index.json",
        "data/cr/citations-ledger.json",
    ];

    it("the card diff really is the cards lane (else the rest proves nothing)", () => {
        expect(classifyLane(CARD_DIFF).lane).toBe("cards");
    });

    it("owes no check:ui receipt — garbage in the body never refuses, and no scope is derived", () => {
        expect(
            computeSkinReceiptInvalid("cards", "garbage, not a receipt")
        ).toBe(false);
        expect(
            skinReceiptInvalidForDiff(
                CARD_DIFF,
                "/nonexistent",
                "garbage, not a receipt",
                () => {
                    throw new Error("scope derived for a non-skin landing");
                }
            )
        ).toBe(false);
    });

    it("owes a preset scenario — a body without one is refused", () => {
        expect(owesScenario(CARD_DIFF)).toBe(true);
        expect(
            scenarioRefusal(
                classifyScenarioSection("## Summary\n\nno scenario here\n"),
                owesScenario(CARD_DIFF)
            )
        ).not.toBeNull();
    });
});
