import { describe, expect, it } from "vitest";
import { staleToolingPaths, staleToolingRefusal } from "../lib/stale-tooling";

describe("stale land tooling (issue #6341)", () => {
    it("a base that moved only product code and tests is not stale", () => {
        expect(
            staleToolingRefusal(
                [
                    "convex/gre/layers.ts",
                    "src/a.tsx",
                    "scripts/__tests__/x.test.ts",
                ],
                "origin/staging"
            )
        ).toBeNull();
    });

    it("a changed land script, guard, package.json or hook is stale", () => {
        const paths = [
            "scripts/land-ready.ts",
            "scripts/lib/derived-in-pr.ts",
            "package.json",
            [".claude", "hooks", "deny-guard.sh"].join("/"),
            "tolaria.config.json",
        ];
        expect(staleToolingPaths(paths)).toEqual(paths);
    });

    it("covers shell and mjs tooling, never a test at any depth", () => {
        expect(
            staleToolingPaths([
                "scripts/gate-run.sh",
                "scripts/x.mjs",
                "scripts/lib/__tests__/y.test.ts",
            ])
        ).toEqual(["scripts/gate-run.sh", "scripts/x.mjs"]);
    });

    it("names the paths and the fix", () => {
        const line = staleToolingRefusal(
            ["scripts/land-ready.ts"],
            "origin/staging"
        );
        expect(line).toContain("scripts/land-ready.ts");
        expect(line).toContain("git rebase origin/staging");
    });
});
