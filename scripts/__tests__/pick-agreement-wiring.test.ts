/**
 * Held-out pick agreement's wiring (issue #3982, ADR 0143): a post-verdict
 * health audit, never a gate. Pattern: `blade-robustness-wiring.test.ts`.
 * The record's own behaviour (it cannot touch the verdict, a report-less
 * success measured nothing) is pinned below.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    PICK_AGREEMENT_STEP,
    claimPickRequest,
    extractPickSummary,
    pickRequestFile,
    readOwedPick,
    runPickAudit,
    writePickRequest,
} from "../lib/health-pick-agreement-audit";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";

const ROOT = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
};

describe("held-out pick agreement wiring (issue #3982)", () => {
    it("is a script running the held-out side of the verdict search runner", () => {
        const body = pkg.scripts[PICK_AGREEMENT_STEP];
        expect(body).toContain("BLADE_VERDICT_SEARCH=1");
        expect(body).toContain("BLADE_VERDICT_SEARCH_SIDE=held-out");
        expect(body).toContain("verdict-search.spec.ts");
    });

    it("is not a health gate; the trigger asks, the cadence runs it after the verdict", () => {
        expect(HEALTH_SCRIPTS).not.toContain(PICK_AGREEMENT_STEP);
        const { offline, walk } = splitHealthGates(HEALTH_SCRIPTS);
        expect([...offline, ...walk]).not.toContain(PICK_AGREEMENT_STEP);
        const main = readFileSync(join(ROOT, "scripts/health-main.ts"), "utf8");
        expect(main).toContain("writePickRequest(");
        const cadence = readFileSync(
            join(ROOT, "scripts/health-cadence.ts"),
            "utf8"
        );
        // After the verdict is on disk, never before it.
        expect(
            cadence.indexOf("spawnPickAgreementAudit(root);")
        ).toBeGreaterThan(cadence.indexOf("writeCadence(root, action.state);"));
    });

    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== PICK_AGREEMENT_STEP &&
                    /verdicts:pick-agreement|BLADE_VERDICT_SEARCH_SIDE/.test(
                        body
                    )
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });

    it("the PR-phase gates never name it", () => {
        for (const file of ["scripts/check-lane.ts", "scripts/land.ts"]) {
            const src = readFileSync(join(ROOT, file), "utf8");
            expect(src, file).not.toMatch(
                /verdicts:pick-agreement|BLADE_VERDICT_SEARCH_SIDE/
            );
        }
    });
});

describe("the pick agreement audit record", () => {
    const SHA = "c43c4b5a3c58aaaa";
    const LAST = { sha: SHA, status: "green" };
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "pick-agreement-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("is owed once the same tip's verdict is GREEN or RED, and claimed once", () => {
        writePickRequest(dir, SHA, "full: search changed", true);
        expect(readOwedPick(dir, SHA, null)).toBeNull();
        expect(
            readOwedPick(dir, SHA, { sha: SHA, status: "running" })
        ).toBeNull();
        expect(readOwedPick(dir, SHA, LAST)?.reason).toBe(
            "full: search changed"
        );
        expect(claimPickRequest(dir, SHA, LAST)).not.toBeNull();
        expect(existsSync(join(dir, pickRequestFile(SHA)))).toBe(false);
        expect(claimPickRequest(dir, SHA, LAST)).toBeNull();
    });

    it("a batch that owes nothing removes its own request", () => {
        writePickRequest(dir, SHA, "x", true);
        writePickRequest(dir, SHA, "x", false);
        expect(existsSync(join(dir, pickRequestFile(SHA)))).toBe(false);
    });

    it("records the report block as measured, and never writes the verdict files", async () => {
        const output = [
            "noise",
            "== held-out pick agreement (issue #3982) — x",
            "  all                : 1/2 (50.0%)  n = 2, indicative, not a claim",
            "",
            "after",
        ].join("\n");
        const record = await runPickAudit({
            dir,
            request: { sha: SHA, reason: "r" },
            log: "l",
            run: async () => ({ ok: true, output, excused: false }),
        });
        expect(record.status).toBe("measured");
        expect(record.summary).toHaveLength(2);
        expect(existsSync(join(dir, "last.json"))).toBe(false);
        expect(existsSync(join(dir, "RED"))).toBe(false);
    });

    it("a failing step is a record, never a verdict; a success with no report measured nothing", async () => {
        const run = (ok: boolean, excused: boolean) =>
            runPickAudit({
                dir,
                request: { sha: SHA, reason: "r" },
                log: "l",
                run: async () => ({ ok, output: "no report", excused }),
            });
        expect((await run(false, false)).status).toBe("failed");
        expect((await run(true, false)).status).toBe("failed");
        expect((await run(false, true)).status).toBe("infra");
        writeFileSync(join(dir, "x"), "");
        expect(extractPickSummary("nothing here")).toEqual([]);
    });
});
