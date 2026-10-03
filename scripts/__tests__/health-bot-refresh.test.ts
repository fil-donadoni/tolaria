// The Bot Findings refresh a health batch owes (ADR 0141 § 5, issue #4181):
// it runs when — and only when — the batch's diff touched the Bot globs, it
// runs in the health batch, and it runs neither in `check:pr` nor in `land`.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { batchTouchesBot, botRefreshSteps } from "../lib/health-bot-refresh";
import { HEALTH_SCRIPTS } from "../lib/health-step";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) =>
    fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("batchTouchesBot", () => {
    it("is true when any changed file falls under the Bot globs", () => {
        expect(
            batchTouchesBot([
                "scripts/health-main.ts",
                "convex/gre/ai/botReach.ts",
            ])
        ).toBe(true);
        expect(batchTouchesBot(["src/lib/ai/eval-term-labels.ts"])).toBe(true);
    });

    it("is false for a batch that left the Bot alone", () => {
        expect(
            batchTouchesBot([
                "src/components/admin/bot-findings-admin-panel.tsx",
                "convex/cards/sets/arn.ts",
                "scripts/health-main.ts",
            ])
        ).toBe(false);
        expect(batchTouchesBot([])).toBe(false);
    });

    it("measures when the diff could not be taken — an unknown batch must not leave the page silently stale", () => {
        expect(batchTouchesBot(null)).toBe(true);
    });
});

describe("botRefreshSteps", () => {
    it("re-measures, seeds the deployment, then files the Bot Gaps, numbered after the gates", () => {
        const steps = botRefreshSteps(6);
        expect(steps.map((s) => [s.ordinal, s.total, s.name])).toEqual([
            [7, 9, "bot:reach"],
            [8, 9, "seed:bot-findings"],
            [9, 9, "gaps:sync"],
        ]);
    });

    it("files from the primary checkout, with no --no-file-bot (issue #4944)", () => {
        const filing = botRefreshSteps(0, "/primary").at(-1)!;
        expect(filing.cwd).toBe("/primary");
        expect(filing.args).toEqual(["run", "gaps:sync"]);
    });

    it("takes the CPU-bound measurement through the heavy gate", () => {
        const [measure] = botRefreshSteps(0);
        expect(measure!.args).toEqual([
            "scripts/gate.ts",
            "heavy",
            "bun run bot:reach",
        ]);
    });
});

describe("where the refresh runs", () => {
    const REFRESH = /bot:reach|seed:bot-findings|health-bot-refresh/;

    it("is not one of the health GATES — it never reds a tip", () => {
        for (const script of HEALTH_SCRIPTS)
            expect(script).not.toMatch(REFRESH);
    });

    it("is wired into the health batch, after the gates and only on a Bot-touching diff", () => {
        const src = read("scripts/health-main.ts");
        expect(src).toContain("batchTouchesBot(batchChangedFiles(root, tip))");
        expect(src).toContain("botRefreshSteps(steps.length, root)");
        // A failed gate skips the refresh: the loop sits under `failedStep === undefined`.
        expect(src).toMatch(
            /if \(failedStep === undefined\) \{[\s\S]*?for \(const step of refreshSteps\)/
        );
    });

    it("is neither in check:pr nor in land", () => {
        const pkg = JSON.parse(read("package.json")) as {
            scripts: Record<string, string>;
        };
        // `check:pr` and everything it chains into.
        for (const name of [
            "check:pr",
            "check:all",
            "check:all:inner",
            "check:guards",
        ])
            expect(pkg.scripts[name] ?? "").not.toMatch(REFRESH);
        expect(read("scripts/land.ts")).not.toMatch(REFRESH);
    });
});
