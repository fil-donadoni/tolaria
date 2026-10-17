// The Bot Findings refresh (ADR 0141 § 5, issue #4181) and the weekly Bot
// audits: they run when — and only when — the base moved the Bot globs (the
// audits: on the weekly night), from `health:nightly` (issue #5458), and
// neither in health, `check:pr` nor `land`.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    AUDIT_WEEKDAY,
    auditsDue,
    batchTouchesBot,
    botRefreshSteps,
} from "../lib/health-bot-refresh";
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

    it("is wired into health:nightly, only on a Bot-touching diff since the last refresh (issue #5458)", () => {
        const pkg = JSON.parse(read("package.json")) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts["health:nightly"]).toBe(
            "bun scripts/health-nightly.ts"
        );
        const src = read("scripts/health-nightly.ts");
        expect(src).toContain("batchTouchesBot(changed)");
        expect(src).toContain("botRefreshSteps(1, root)");
        expect(src).toContain("auditsDue({");
    });

    it("is no longer wired into the health batch (issue #5458)", () => {
        for (const file of ["scripts/health-main.ts"]) {
            const src = read(file);
            expect(src, file).not.toContain("botRefreshSteps(");
            expect(src, file).not.toContain("batchTouchesBot(");
            expect(src, file).not.toContain("health-bot-refresh");
        }
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

describe("auditsDue — the weekly audits (issue #5458)", () => {
    const DAY = 24 * 60 * 60 * 1000;
    /** A local-time date on the given weekday, at 03:00. */
    function on(weekday: number): Date {
        const d = new Date(2026, 9, 11, 3, 0, 0); // a Sunday
        d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
        return d;
    }
    const audit = AUDIT_WEEKDAY;
    const other = (AUDIT_WEEKDAY + 3) % 7;

    it("is due on the weekly night", () => {
        const now = on(audit);
        expect(
            auditsDue({ now, lastAuditAt: now.getTime() - 7 * DAY }).due
        ).toBe(true);
        expect(auditsDue({ now, lastAuditAt: null }).due).toBe(true);
    });

    it("is not due on another night within the week", () => {
        const now = on(other);
        expect(
            auditsDue({ now, lastAuditAt: now.getTime() - 3 * DAY })
        ).toEqual({ due: false, reason: "not the weekly audit night" });
        expect(auditsDue({ now, lastAuditAt: null }).due).toBe(false);
    });

    it("does not re-run on the weekly night once it ran within the day", () => {
        const now = on(audit);
        expect(
            auditsDue({ now, lastAuditAt: now.getTime() - 2 * 60 * 60 * 1000 })
                .due
        ).toBe(false);
    });

    it("catches up on any night once the weekly night was missed", () => {
        const now = on(other);
        const v = auditsDue({ now, lastAuditAt: now.getTime() - 9 * DAY });
        expect(v.due).toBe(true);
        expect(v.reason).toMatch(/missed/);
    });

    it("runs whatever the day when asked", () => {
        const now = on(other);
        expect(
            auditsDue({ now, lastAuditAt: now.getTime() - DAY, force: true })
                .due
        ).toBe(true);
    });
});
