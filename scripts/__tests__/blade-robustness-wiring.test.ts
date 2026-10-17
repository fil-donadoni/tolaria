/**
 * The blade robustness audit's wiring (issue #4875): run WEEKLY by
 * `health:nightly` (issue #5458), never by `health`, `check:pr`,
 * `check:lane` or `land`. Minutes of search is not a cost any gate pays. What its failure means to the batch — RED only for an
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

    it("health neither gates on it nor asks for it: the nightly runs it weekly (issue #5458)", () => {
        expect(HEALTH_SCRIPTS).not.toContain("blade:robustness");
        for (const file of ["scripts/health-main.ts"]) {
            const src = readFileSync(join(ROOT, file), "utf8");
            expect(src, file).not.toContain("writeAuditRequest(");
            expect(src, file).not.toContain("robustnessOutcome(");
            expect(src, file).not.toContain('"health-robustness-audit.ts"');
        }
        const nightly = readFileSync(
            join(ROOT, "scripts/health-nightly.ts"),
            "utf8"
        );
        expect(nightly).toContain("writeAuditRequest(dir, sha, mode, true)");
        expect(nightly).toContain('"health-robustness-audit.ts"');
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
