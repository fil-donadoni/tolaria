/**
 * The blade robustness audit's wiring (issue #4875): a `health` gate for a
 * batch that can have moved it (`robustnessMode`, issue #5078), and nothing else — never `check:pr`, `check:lane` or `land`. Minutes of search
 * per run is a batch cost (issue #4490: a new guard goes on `health`, never on
 * a PR-phase gate). What its failure means to the batch — RED only for an
 * entry failing its own seeds, drift filed as an issue — is
 * `health-robustness-drift.test.ts` (issue #5016).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HEALTH_SCRIPTS } from "../lib/health-step";

const ROOT = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
};

describe("blade:robustness wiring (issue #4875)", () => {
    it("is a heavy gate script running the opt-in shard specs", () => {
        const body = pkg.scripts["blade:robustness"];
        expect(body).toMatch(/^bun scripts\/gate\.ts heavy /);
        expect(body).toContain("BLADE_ROBUSTNESS=1");
        expect(body).toContain("robustness.shard");
    });

    it("health does not gate on it: the trigger asks, the cadence runs it after the verdict (issue #5079)", () => {
        expect(HEALTH_SCRIPTS).not.toContain("blade:robustness");
        const main = readFileSync(join(ROOT, "scripts/health-main.ts"), "utf8");
        expect(main).toContain(
            "writeAuditRequest(dir, tip, robustness, robustnessOwed(robustness))"
        );
        expect(main).not.toContain("robustnessOutcome(");
        const cadence = readFileSync(
            join(ROOT, "scripts/health-cadence.ts"),
            "utf8"
        );
        // After the verdict is on disk, never before it.
        expect(cadence.indexOf("spawnRobustnessAudit(root);")).toBeGreaterThan(
            cadence.indexOf("writeCadence(root, action.state);")
        );
    });

    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== "blade:robustness" &&
                    /blade:robustness|BLADE_ROBUSTNESS/.test(body)
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });

    it("the PR-phase gates never name it", () => {
        for (const file of ["scripts/check-lane.ts", "scripts/land.ts"]) {
            const src = readFileSync(join(ROOT, file), "utf8");
            expect(src, file).not.toMatch(/blade:robustness|BLADE_ROBUSTNESS/);
        }
    });
});
