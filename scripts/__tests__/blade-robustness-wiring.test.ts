/**
 * The blade robustness audit's wiring (issue #4875): a `health` step and
 * nothing else — never `check:pr`, `check:lane` or `land`. Minutes of search
 * per run is a batch cost (issue #4490: a new guard goes on `health`, never on
 * a PR-phase gate).
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

    it("is a health step, after the test suites", () => {
        expect(HEALTH_SCRIPTS).toContain("blade:robustness");
        expect(HEALTH_SCRIPTS.indexOf("blade:robustness")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("test")
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
