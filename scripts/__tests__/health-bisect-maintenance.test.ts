import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maintenanceRefusal } from "../health-revert";
import {
    BOT_REPLAY_COMMIT_SUBJECT,
    DERIVE_SYNC_COMMIT_SUBJECT,
    isBaseMaintenanceSubject,
} from "../lib/derive-sync";
import { TREE_ROLE_ENV } from "../lib/derived-state";
import {
    attributeMaintenance,
    bisectCulprits,
    culpritLines,
    PROBE_BOOTSTRAP,
    type CulpritReport,
    type TestProbe,
} from "../lib/health-bisect";
import type { FailingTest } from "../lib/health-evidence";

/**
 * Issue #7417: a RED caused by a PR's DERIVED effect (its cards reach the
 * catalogue only once the base's `derive:sync` writes it, ADR 0157) bisected
 * onto the derive commit, which the ladder then reverted — a revert that can
 * never land. The probe now runs as the queue draft, and a maintenance
 * commit is never the culprit.
 */

const CUT: FailingTest = {
    file: "convex/limited/__tests__/draftLabCutExperiment.bot.test.ts",
};

describe("the incident's shape: a PR's cards break a test only once derive:sync writes the catalogue", () => {
    let dir: string | null = null;
    afterEach(() => {
        if (dir)
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        dir = null;
    });

    function git(args: string[]): string {
        const r = spawnSync("git", args, { cwd: dir!, encoding: "utf8" });
        if (r.status !== 0) throw new Error(r.stderr);
        return r.stdout.trim();
    }

    /** The fixture's `derive:regenerate`: the catalogue is the cards. */
    const regenerate = (cards: string) => `catalogue of ${cards}`;

    /**
     * A repo whose test reads the CATALOGUE (derived) and fails on a red
     * card; PR #7396 adds one to the SOURCES, and only the base's
     * `derive:sync` after it moves the catalogue — as on 2026-10-28.
     */
    function history() {
        dir = mkdtempSync(join(tmpdir(), "health-bisect-maint-"));
        git(["init", "-q", "-b", "main"]);
        git(["config", "user.email", "t@example.com"]);
        git(["config", "user.name", "t"]);
        const commit = (msg: string, files: Record<string, string>) => {
            for (const [f, text] of Object.entries(files))
                writeFileSync(join(dir!, f), text);
            git(["add", "."]);
            git(["commit", "-q", "--allow-empty", "-m", msg]);
            return git(["rev-parse", "HEAD"]);
        };
        const good = commit("green base (#7390)", {
            "cards.txt": "green",
            "catalogue.txt": regenerate("green"),
        });
        const other = commit("docs only (#7395)", { "n.txt": "1" });
        const pr = commit("add red cards to the cube (#7396)", {
            "cards.txt": "green red",
        });
        const derive = commit(DERIVE_SYNC_COMMIT_SUBJECT, {
            "catalogue.txt": regenerate("green red"),
        });
        const red = commit("unrelated (#7398)", { "n.txt": "2" });
        const commits = git([
            "rev-list",
            "--first-parent",
            "--reverse",
            `${good}..${red}`,
        ]).split("\n");
        return { good, other, pr, derive, red, commits };
    }

    const show = (sha: string, file: string) => git(["show", `${sha}:${file}`]);

    /** The probe a bootstrap makes: each `derive:regenerate` step rewrites
     *  the catalogue from the probed commit's cards; the test then reads it. */
    const probeWith =
        (steps: readonly (readonly string[])[]) =>
        (sha: string, tests: readonly FailingTest[]): TestProbe => {
            let catalogue = show(sha, "catalogue.txt");
            for (const step of steps)
                if (step.join(" ") === "run derive:regenerate")
                    catalogue = regenerate(show(sha, "cards.txt"));
            return catalogue.includes("red") ? [...tests] : [];
        };

    const subjectOf = (sha: string) => git(["log", "-1", "--format=%s", sha]);

    it("probed as committed, the first red commit is the derive commit — the blame the ladder reverted", () => {
        const h = history();
        const report = bisectCulprits(
            h.commits,
            [CUT],
            probeWith([["run", "worktree:init"]])
        );
        expect(report.found.map((f) => f.culprit)).toEqual([h.derive]);
    });

    it("probed as the queue draft (PROBE_BOOTSTRAP), the PR commit reads its own RED", () => {
        const h = history();
        expect(PROBE_BOOTSTRAP.env).toEqual({ [TREE_ROLE_ENV]: "draft" });
        const report = bisectCulprits(
            h.commits,
            [CUT],
            probeWith(PROBE_BOOTSTRAP.steps)
        );
        expect(report.found.map((f) => f.culprit)).toEqual([h.pr]);
        const lines = culpritLines({
            report: attributeMaintenance(report, h.commits, subjectOf),
            total: 1,
            good: h.good,
            commits: h.commits.length,
            subjectOf,
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("PR #7396");
        expect(lines[0]).not.toContain("base maintenance");
    });

    it("a first red probe on the derive commit anyway names the PR commits since the previous maintenance commit", () => {
        const h = history();
        const report = attributeMaintenance(
            bisectCulprits(h.commits, [CUT], probeWith([])),
            h.commits,
            subjectOf
        );
        expect(report.found.map((f) => f.culprit)).toEqual([h.other, h.pr]);
        expect(report.found.every((f) => f.maintenance === h.derive)).toBe(
            true
        );
        const lines = culpritLines({
            report,
            total: 1,
            good: h.good,
            commits: h.commits.length,
            subjectOf,
        });
        expect(lines.some((l) => l.includes("PR #7396"))).toBe(true);
        expect(lines.every((l) => !l.includes("a direct commit"))).toBe(true);
        expect(lines[0]).toContain(
            `base maintenance \`${h.derive.slice(0, 12)}\``
        );
    });
});

describe("attributeMaintenance — the window since the previous maintenance commit", () => {
    const subjects: Record<string, string> = {
        a: "first (#1)",
        b: DERIVE_SYNC_COMMIT_SUBJECT,
        c: "second (#2)",
        d: BOT_REPLAY_COMMIT_SUBJECT,
    };
    const subjectOf = (sha: string) => subjects[sha];
    const report = (culprit: string): CulpritReport => ({
        found: [{ culprit, tests: [CUT] }],
        unexplained: null,
        probes: [],
    });

    it("a bot-replay culprit names only the PR commits after the previous derive commit", () => {
        const out = attributeMaintenance(
            report("d"),
            ["a", "b", "c", "d"],
            subjectOf
        );
        expect(out.found.map((f) => f.culprit)).toEqual(["c"]);
        expect(out.unexplained).toBeNull();
    });

    it("no PR commit before it in the range: unexplained, never the maintenance commit", () => {
        const out = attributeMaintenance(
            report("b"),
            ["b", "c", "d"],
            subjectOf
        );
        expect(out.found).toEqual([]);
        expect(out.unexplained?.tests).toEqual([CUT]);
        expect(out.unexplained?.reason).toContain("base maintenance");
    });

    it("a PR culprit is left as it is", () => {
        const out = attributeMaintenance(
            report("c"),
            ["a", "b", "c", "d"],
            subjectOf
        );
        expect(out.found).toEqual([{ culprit: "c", tests: [CUT] }]);
    });
});

describe("health:revert refuses a base-maintenance culprit (issue #7417)", () => {
    it.each([DERIVE_SYNC_COMMIT_SUBJECT, BOT_REPLAY_COMMIT_SUBJECT])(
        "refuses `%s`, naming the rule",
        (subject) => {
            expect(isBaseMaintenanceSubject(subject)).toBe(true);
            const why = maintenanceRefusal("4706e0d0c3a0", {
                ok: true,
                out: subject,
            });
            expect(why).toContain("base-maintenance commit");
            expect(why).toContain("check:derived-in-diff");
        }
    );

    it("lets a PR commit, or an unreadable one, through", () => {
        expect(
            maintenanceRefusal("0f603f4b4443", {
                ok: true,
                out: "add red cards to the cube (#7396)",
            })
        ).toBeNull();
        expect(
            maintenanceRefusal("deadbeef", {
                ok: false,
                out: DERIVE_SYNC_COMMIT_SUBJECT,
            })
        ).toBeNull();
    });
});
