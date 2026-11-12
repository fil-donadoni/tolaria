/**
 * Held-out pick agreement's wiring (issue #8698, ADR 0138): run by hand after
 * `verdicts:promote`, never by health, the nightly or a PR gate. At n = 24 the
 * number moves run to run, so an automated reading is a false alarm; the
 * promotion report ends on the pointer that tells the operator to run it
 * (`verdict-promotion-run.bot.test.ts` pins that line).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";

const ROOT = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
};
const STEP = "verdicts:pick-agreement";

describe("held-out pick agreement wiring (issue #8698)", () => {
    it("is a script running the held-out side of the verdict search runner", () => {
        const body = pkg.scripts[STEP];
        expect(body).toContain("BLADE_VERDICT_SEARCH=1");
        expect(body).toContain("BLADE_VERDICT_SEARCH_SIDE=held-out");
        expect(body).toContain("verdict-search.spec.ts");
    });

    it("is neither a health gate nor an audit health or the nightly runs", () => {
        expect(HEALTH_SCRIPTS).not.toContain(STEP);
        const { offline, browser } = splitHealthGates(HEALTH_SCRIPTS);
        expect([...offline, ...browser]).not.toContain(STEP);
        for (const file of [
            "scripts/health-main.ts",
            "scripts/health-nightly.ts",
        ]) {
            const src = readFileSync(join(ROOT, file), "utf8");
            expect(src, file).not.toMatch(/pick-agreement|PickRe(quest|cord)/);
        }
        expect(
            existsSync(join(ROOT, "scripts/health-pick-agreement-audit.ts"))
        ).toBe(false);
    });

    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== STEP &&
                    /verdicts:pick-agreement|BLADE_VERDICT_SEARCH_SIDE/.test(
                        body
                    )
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });

    it("the PR-phase gates never name it", () => {
        for (const file of ["scripts/check-lane.ts", "scripts/land-ready.ts"]) {
            const src = readFileSync(join(ROOT, file), "utf8");
            expect(src, file).not.toMatch(
                /verdicts:pick-agreement|BLADE_VERDICT_SEARCH_SIDE/
            );
        }
    });
});
