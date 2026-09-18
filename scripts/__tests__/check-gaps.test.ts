import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { HEALTH_SCRIPTS } from "../lib/health-step";
import { opGapKey } from "../lib/grammar-gaps";
import {
    auditOpCensus,
    baselineAllowlist,
    emittedOps,
    parseAllowlist,
    render,
    type Allowlist,
    type Violation,
} from "../check-gaps";

/**
 * The derived Op census guard (ADR 0105 § 7.3, issue #3824).
 *
 * PURE over fixtures, on purpose. The live census — the committed allowlist
 * against the committed lockfile — is `bun run check:gaps`, and this file must
 * not become a second copy of it: `scripts/__tests__` runs inside
 * `check:guards`, which runs inside `check:pr`, and the whole point of the
 * census living in `health` is that a PR pays nothing for it. Asserting the
 * real files here would reintroduce the cost the ADR removed, and would red
 * every branch the day an Op is added rather than the batch that lands it.
 */

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { scripts: Record<string, string> };

const row = (op: string, issue = 3820) => ({ key: opGapKey(op), op, issue });
const list = (...ops: string[]): Allowlist => ({ ops: ops.map((o) => row(o)) });
const kinds = (vs: readonly Violation[]) => vs.map((v) => `${v.kind}:${v.op}`);

describe("check:gaps runs in health, and nowhere else", () => {
    it("is a script of its own", () => {
        expect(pkg.scripts["check:gaps"]).toBe("bun scripts/check-gaps.ts");
    });

    it("is a health step", () => {
        expect(HEALTH_SCRIPTS).toContain("check:gaps");
    });

    it("runs after check:all, which owns the lockfile drift guard", () => {
        expect(HEALTH_SCRIPTS.indexOf("check:gaps")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("check:all")
        );
    });

    it("health-main reads the list rather than keeping its own copy", () => {
        const src = fs.readFileSync(
            path.join(ROOT, "scripts/health-main.ts"),
            "utf8"
        );
        expect(src).toContain("const scripts = HEALTH_SCRIPTS;");
    });

    // The census is offline but reads a 17 MB lockfile and answers a question
    // no PR diff can change on its own. It stays out of every PR-phase gate.
    //
    // Scanned rather than enumerated: an enumeration covers `check:all:inner`
    // and misses the `check:all` that wraps it, and stops covering anything
    // renamed or newly composed (review of PR #3878).
    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== "check:gaps" && body.includes("check:gaps")
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });
});

describe("emittedOps", () => {
    it("counts ready AND quarantine — quarantine gates the card, not the grammar", () => {
        const emitted = emittedOps([
            { state: "ready", opsUsed: ["draw"] },
            { state: "quarantine", opsUsed: ["mill", "draw"] },
            { state: "unparsed", opsUsed: ["exile"] },
            { state: "unparsed" },
        ]);
        expect([...emitted].sort()).toEqual(["draw", "mill"]);
    });

    // Reading it as "emits nothing" would be a false `missing`, and a
    // `missing` has no legal exit — a row may not be added.
    it("refuses a compiled row with no opsUsed rather than reading it as empty", () => {
        expect(() =>
            emittedOps([{ name: "Black Lotus", state: "ready" }])
        ).toThrow(/Black Lotus is `ready` with no `opsUsed`/);
    });
});

describe("auditOpCensus", () => {
    it("passes when every never-emitted Op has a row", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill", "exile"],
            emitted: new Set(["draw"]),
            allowlist: list("mill", "exile"),
            baseline: list("mill", "exile"),
        });
        expect(result.violations).toEqual([]);
        expect(result.baselineChecked).toBe(true);
        expect(result.emittedCount).toBe(1);
        expect(result.allowlistedCount).toBe(2);
    });

    it("reds an emitted-by-nothing Op with no row", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill"],
            emitted: new Set(["draw"]),
            allowlist: list(),
            baseline: list(),
        });
        expect(kinds(result.violations)).toEqual(["missing:mill"]);
    });

    it("reds a row whose Op is now emitted — the rule landed, the row goes", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill"],
            emitted: new Set(["draw", "mill"]),
            allowlist: list("mill"),
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["covered:mill"]);
    });

    it("reds a row for an Op the registry does not implement", () => {
        const result = auditOpCensus({
            implemented: ["draw"],
            emitted: new Set(["draw"]),
            allowlist: list("getEnergy"),
            baseline: list("getEnergy"),
        });
        expect(kinds(result.violations)).toEqual(["unknown-op:getEnergy"]);
    });

    it("reds a duplicated row", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: { ops: [row("mill"), row("mill")] },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["duplicate:mill"]);
    });

    it("reds a row whose key is not the stable key `gaps:sync` shares", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: { ops: [{ key: "mill", op: "mill", issue: 3820 }] },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["malformed:mill"]);
        expect(result.violations[0]).toMatchObject({
            detail: expect.stringContaining("(op) › mill"),
        });
    });

    it("reds a row with no issue number", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: {
                ops: [{ key: opGapKey("mill"), op: "mill", issue: 0 }],
            },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["malformed:mill"]);
    });

    // A new Op is DOUBLY refused: it has no row (missing) and may not gain one
    // (grown). ADR 0137's single exit is the grammar rule that emits it.
    it("reds a row the previous revision did not have — the allowlist only shrinks", () => {
        const result = auditOpCensus({
            implemented: ["draw", "explore"],
            emitted: new Set(["draw"]),
            allowlist: list("explore"),
            baseline: list(),
        });
        expect(kinds(result.violations)).toEqual(["grown:explore"]);
    });

    it("leaves the shrink check unrun when there is no previous revision", () => {
        const result = auditOpCensus({
            implemented: ["draw", "explore"],
            emitted: new Set(["draw"]),
            allowlist: list("explore"),
            baseline: null,
        });
        expect(result.violations).toEqual([]);
        expect(result.baselineChecked).toBe(false);
    });

    it("orders violations deterministically", () => {
        const input = {
            implemented: ["draw", "mill", "exile", "scryReorder"],
            emitted: new Set(["draw", "mill"]),
            allowlist: list("mill", "scryReorder"),
            baseline: list("mill"),
        };
        const once = kinds(auditOpCensus(input).violations);
        expect(once).toEqual(kinds(auditOpCensus(input).violations));
        expect(once).toEqual([
            "covered:mill",
            "missing:exile",
            "grown:scryReorder",
        ]);
    });
});

describe("the committed allowlist", () => {
    // Shape only — never the census itself (see this file's header).
    const allowlist = parseAllowlist(
        fs.readFileSync(path.join(ROOT, "data/grammar-gaps.json"), "utf8")
    );

    it("carries Op, issue and the stable key on every row", () => {
        expect(allowlist.ops.length).toBeGreaterThan(0);
        for (const r of allowlist.ops) {
            expect(r.key).toBe(opGapKey(r.op));
            expect(Number.isInteger(r.issue) && r.issue > 0).toBe(true);
        }
    });

    it("holds one row per Op, sorted", () => {
        const ops = allowlist.ops.map((r) => r.op);
        expect(new Set(ops).size).toBe(ops.length);
        expect(ops).toEqual([...ops].sort());
    });
});

describe("baselineAllowlist", () => {
    /**
     * A throwaway repo whose `data/grammar-gaps.json` has the given revisions,
     * oldest first. Returns its path with HEAD at the last one.
     */
    function repoWith(...revisions: Allowlist[]): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-baseline-"));
        const git = (...args: string[]) => {
            const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
            if (r.status !== 0)
                throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
            return r.stdout.trim();
        };
        git("init", "-q", "-b", "staging");
        git("config", "user.email", "t@t");
        git("config", "user.name", "t");
        fs.mkdirSync(path.join(dir, "data"));
        for (const [i, rev] of revisions.entries()) {
            fs.writeFileSync(
                path.join(dir, "data/grammar-gaps.json"),
                JSON.stringify(rev, null, 4) + "\n"
            );
            git("add", "-A");
            git("commit", "-q", "-m", `rev ${i}`);
        }
        return dir;
    }

    it("is the file's own previous revision", () => {
        const dir = repoWith(list("mill", "exile"), list("mill"));
        expect(baselineAllowlist(dir)?.ops.map((r) => r.op)).toEqual([
            "mill",
            "exile",
        ]);
    });

    /**
     * The regression this test exists for. `check:gaps` runs ONLY in `health`,
     * and `health` gates a `git worktree add --detach <base tip>`. The first
     * implementation read the allowlist at `merge-base(HEAD, origin/<base>)`,
     * which in that worktree IS HEAD — so the baseline was the very file being
     * audited, `grown` could never fire, and shrink-only was unenforced
     * everywhere it ran (review of PR #3878).
     */
    it("survives a detached HEAD sitting exactly on the base branch tip", () => {
        const dir = repoWith(list("mill"), list("mill", "explore"));
        const git = (...args: string[]) =>
            spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        git("update-ref", "refs/remotes/origin/staging", "HEAD");
        git("checkout", "-q", "--detach", "HEAD");
        expect(git("merge-base", "HEAD", "origin/staging").stdout.trim()).toBe(
            git("rev-parse", "HEAD").stdout.trim()
        );

        const baseline = baselineAllowlist(dir);
        expect(baseline?.ops.map((r) => r.op)).toEqual(["mill"]);
        const result = auditOpCensus({
            implemented: ["mill", "explore"],
            emitted: new Set(),
            allowlist: list("mill", "explore"),
            baseline,
        });
        expect(kinds(result.violations)).toEqual(["grown:explore"]);
    });

    it("has none at the commit that introduces the file", () => {
        expect(baselineAllowlist(repoWith(list("mill")))).toBeNull();
    });

    it("has none outside a git repository", () => {
        expect(
            baselineAllowlist(fs.mkdtempSync(path.join(os.tmpdir(), "nogit-")))
        ).toBeNull();
    });
});

describe("render", () => {
    const green = (baseline: Allowlist | null) =>
        render(
            auditOpCensus({
                implemented: ["draw"],
                emitted: new Set(["draw"]),
                allowlist: { ops: [] },
                baseline,
            })
        );

    it("says so when the shrink check did not run", () => {
        expect(green(null)).toContain("shrink check SKIPPED");
        expect(green({ ops: [] })).toContain("shrink verified");
    });

    // A red that omits it would let a reader assume `grown` was evaluated.
    it("says so on the violation path too", () => {
        const red = render(
            auditOpCensus({
                implemented: ["draw", "mill"],
                emitted: new Set(["draw"]),
                allowlist: { ops: [] },
                baseline: null,
            })
        );
        expect(red).toContain("shrink check SKIPPED");
        expect(red).toContain("do not add a row");
        expect(red).toContain("/new-op");
    });
});
