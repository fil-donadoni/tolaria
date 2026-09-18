import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { HEALTH_SCRIPTS } from "../lib/health-step";
import { opGapKey } from "../lib/grammar-gaps";
import {
    auditOpCensus,
    emittedOps,
    parseAllowlist,
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
    it.each([
        "check:all:inner",
        "check:pr",
        "check:guards",
        "check:docs:inner",
    ])("%s does not run it", (script) => {
        expect(pkg.scripts[script]).not.toContain("check:gaps");
    });
});

describe("emittedOps", () => {
    it("counts ready AND quarantine — quarantine gates the card, not the grammar", () => {
        const emitted = emittedOps([
            { state: "ready", opsUsed: ["draw"] },
            { state: "quarantine", opsUsed: ["mill", "draw"] },
            { state: "unparsed", opsUsed: ["exile"] },
            { state: "ready" },
        ]);
        expect([...emitted].sort()).toEqual(["draw", "mill"]);
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
    it("reds a row added since the merge-base — the allowlist only shrinks", () => {
        const result = auditOpCensus({
            implemented: ["draw", "explore"],
            emitted: new Set(["draw"]),
            allowlist: list("explore"),
            baseline: list(),
        });
        expect(kinds(result.violations)).toEqual(["grown:explore"]);
    });

    it("leaves the shrink check unrun when the merge-base has no allowlist", () => {
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
