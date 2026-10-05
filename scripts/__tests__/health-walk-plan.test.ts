import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
    describeWalkPlan,
    FULL_WALK_ENTRY,
    parseScopeOnly,
    planHealthWalk,
    SKIPPED_REASON,
    walkEntriesFor,
} from "../lib/health-walk-plan";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";
import { renderUiScope, type UiScope } from "../lib/ui-scope";

/**
 * Batch health walks only what the batch can reach (ADR 0131 amendment,
 * issue #5076). The plan is pure: the scoper's stdout is injected, and the
 * stdout used here is what `renderUiScope` really prints.
 */
const GREEN = "a".repeat(40);
const printed = (scope: UiScope): string => renderUiScope(scope, GREEN);
const WALK = splitHealthGates(HEALTH_SCRIPTS).walk;

describe("planHealthWalk", () => {
    it("skips the walk, scoper unasked, when the batch is prose only", () => {
        const scopeOutput = vi.fn(() =>
            printed({ kind: "scoped", surfaces: [] })
        );
        const plan = planHealthWalk({
            forceAll: false,
            changed: ["docs/adr/README.md", "CLAUDE.md"],
            scopeOutput,
        });
        expect(plan).toEqual({ kind: "skipped", reason: SKIPPED_REASON });
        expect(scopeOutput).not.toHaveBeenCalled();
        // No step runs: today's unconditional `--all` would still return WALK.
        expect(walkEntriesFor(WALK, plan, GREEN)).toEqual([]);
        expect(WALK).toEqual([FULL_WALK_ENTRY]);
    });

    it("skips an engine/scripts batch the scoper places nowhere", () => {
        const plan = planHealthWalk({
            forceAll: false,
            changed: ["convex/gre/state.ts", "scripts/land.ts"],
            scopeOutput: () => printed({ kind: "scoped", surfaces: [] }),
        });
        expect(plan.kind).toBe("skipped");
    });

    it("walks SCOPED with exactly the scope the scoper printed", () => {
        const plan = planHealthWalk({
            forceAll: false,
            changed: ["src/components/game/Hand.tsx"],
            scopeOutput: () =>
                printed({ kind: "scoped", surfaces: ["game", "lobby"] }),
        });
        expect(plan).toEqual({ kind: "scoped", surfaces: ["game", "lobby"] });
        expect(walkEntriesFor(WALK, plan, GREEN)).toEqual([
            `check:ui --base=${GREEN}`,
        ]);
        expect(describeWalkPlan(plan)).toContain("scoped — 2 surface(s)");
    });

    it("walks FULL when the scoper says a global input changed", () => {
        const plan = planHealthWalk({
            forceAll: false,
            changed: ["src/index.css"],
            scopeOutput: () =>
                printed({
                    kind: "full",
                    reason: "src/index.css is a stylesheet",
                }),
        });
        expect(plan).toEqual({
            kind: "full",
            reason: "src/index.css is a stylesheet",
        });
        expect(walkEntriesFor(WALK, plan, GREEN)).toEqual([FULL_WALK_ENTRY]);
    });

    it("walks FULL when the last GREEN tip is unknown (fail-closed)", () => {
        const scopeOutput = vi.fn(() => null);
        const plan = planHealthWalk({
            forceAll: false,
            changed: null,
            scopeOutput,
        });
        expect(plan.kind).toBe("full");
        expect(scopeOutput).not.toHaveBeenCalled();
        expect(walkEntriesFor(WALK, plan, null)).toEqual([FULL_WALK_ENTRY]);
    });

    it("walks FULL when the scoper fails or prints something unreadable", () => {
        for (const out of [
            null,
            "boom",
            "scope (diff base x): SCOPED — 2 surface(s)\n  · a",
        ]) {
            const plan = planHealthWalk({
                forceAll: false,
                changed: ["src/components/x.tsx"],
                scopeOutput: () => out,
            });
            expect(plan.kind).toBe("full");
        }
    });

    it("walks FULL when the batch edits the surface table", () => {
        const plan = planHealthWalk({
            forceAll: false,
            changed: ["scripts/ui-gate/surfaces.ts"],
            scopeOutput: () => printed({ kind: "scoped", surfaces: ["a"] }),
        });
        expect(plan.kind).toBe("full");
    });

    it("forces FULL on --ui-all / release, even for a docs batch", () => {
        const plan = planHealthWalk({
            forceAll: true,
            changed: ["docs/x.md"],
            scopeOutput: () => null,
        });
        expect(plan.kind).toBe("full");
    });
});

describe("parseScopeOnly", () => {
    it("round-trips renderUiScope", () => {
        expect(
            parseScopeOnly(printed({ kind: "scoped", surfaces: ["a", "b"] }))
        ).toEqual({ kind: "scoped", surfaces: ["a", "b"] });
        expect(
            parseScopeOnly(printed({ kind: "full", reason: "why" }))
        ).toEqual({ kind: "full", reason: "why" });
    });
});

describe("release", () => {
    it("keeps the full walk: health-main is spawned with --ui-all", () => {
        const src = readFileSync(join(__dirname, "..", "release.ts"), "utf8");
        expect(src).toMatch(
            /\[HEALTH_MAIN, `--branch=\$\{BASE_BRANCH\}`, "--ui-all"\]/
        );
    });
});
