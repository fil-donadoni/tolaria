import { describe, it, expect } from "vitest";
import {
    MANUAL_COMMAND,
    claudeArgs,
    parseVerdict,
    spawnDecision,
    verdictPath,
    type HealthRecord,
    type SpawnInputs,
} from "../health-fix";

/**
 * `bun run health:fix` (PRD issue #3197) — the two decisions this script
 * makes are pure, and this file is where every branch of both is enumerated.
 * Nothing here spawns an agent, runs a gate or touches a git remote.
 *
 * Prior art: `release.test.ts` for `releaseDecision`, one `it` per branch
 * with the refusal reasons asserted by pattern.
 */
describe("health:fix — spawnDecision", () => {
    const tip = "a".repeat(40);
    const other = "b".repeat(40);
    const red: HealthRecord = {
        sha: tip,
        status: "red",
        failedStep: "test",
        log: "/x/health.log",
    };
    const base: SpawnInputs = {
        redMarker: true,
        last: red,
        tip,
        interactive: true,
    };
    const refusal = (input: Partial<SpawnInputs>): string => {
        const d = spawnDecision({ ...base, ...input });
        expect(d.kind).toBe("refuse");
        return d.kind === "refuse" ? d.reason : "";
    };

    it("spawns on a RED marker whose record is about the base tip, with a terminal", () => {
        expect(spawnDecision(base)).toEqual({
            kind: "spawn",
            sha: tip,
            failedStep: "test",
        });
    });

    it("refuses when there is no RED marker — nothing to fix, and that is an exit 0", () => {
        const d = spawnDecision({ ...base, redMarker: false });
        expect(d.kind).toBe("refuse");
        expect(d.kind === "refuse" && d.reason).toMatch(/no RED marker/);
        expect(d.kind === "refuse" && d.nothingToFix).toBe(true);
    });

    it("refuses when a RED marker exists but no health record was ever written", () => {
        expect(refusal({ last: null })).toMatch(/no health record/);
    });

    it("refuses when the health record is about a DIFFERENT sha, naming both", () => {
        const reason = refusal({ last: { ...red, sha: other } });
        expect(reason).toMatch(/bbbbbbbb/);
        expect(reason).toMatch(/aaaaaaaa/);
        expect(reason).toMatch(/not the base tip/);
    });

    it("refuses when the record about the tip is not RED — a stale marker is not a repair order", () => {
        expect(refusal({ last: { sha: tip, status: "running" } })).toMatch(
            /RUNNING/
        );
        expect(refusal({ last: { sha: tip, status: "green" } })).toMatch(
            /GREEN/
        );
    });

    it("refuses without a TTY and prints the command to run by hand", () => {
        const reason = refusal({ interactive: false });
        expect(reason).toMatch(/not a terminal/);
        expect(reason).toContain(MANUAL_COMMAND);
    });

    it("declining is never 'nothing to fix' — only an absent marker is", () => {
        for (const input of [
            { last: null },
            { last: { ...red, sha: other } },
            { last: { sha: tip, status: "green" as const } },
            { interactive: false },
        ]) {
            const d = spawnDecision({ ...base, ...input });
            expect(d.kind === "refuse" && d.nothingToFix).toBe(false);
        }
    });

    it("prefers 'nothing to fix' over the TTY refusal on a green tree", () => {
        // A cron job on a healthy tree must not be told to open a terminal.
        const d = spawnDecision({
            ...base,
            redMarker: false,
            interactive: false,
        });
        expect(d.kind === "refuse" && d.reason).toMatch(/no RED marker/);
    });
});

/**
 * Fail-closed parsing carries the weight of the whole feature: every case
 * below would otherwise promote a tip nobody fixed.
 */
describe("health:fix — parseVerdict", () => {
    const sha = "c".repeat(40);
    const other = "d".repeat(40);
    const json = (doc: unknown): string => JSON.stringify(doc);

    it("reads an unambiguous landed verdict about the expected sha", () => {
        expect(
            parseVerdict(
                json({ sha, outcome: "landed", pr: 3199, note: "two lines" }),
                sha
            )
        ).toEqual({ sha, outcome: "landed", pr: 3199, note: "two lines" });
    });

    it("reads a landed verdict with no PR — a fix can land without one being recorded", () => {
        const v = parseVerdict(json({ sha, outcome: "landed" }), sha);
        expect(v.outcome).toBe("landed");
        expect(v.pr).toBeUndefined();
    });

    it("reads an explicit stuck verdict and keeps the fixer's note", () => {
        const v = parseVerdict(
            json({ sha, outcome: "stuck", note: "cause not established" }),
            sha
        );
        expect(v).toEqual({
            sha,
            outcome: "stuck",
            pr: undefined,
            note: "cause not established",
        });
    });

    it("an explicit stuck verdict with no note still says something", () => {
        expect(parseVerdict(json({ sha, outcome: "stuck" }), sha).note).toMatch(
            /stuck/
        );
    });

    it("an ABSENT verdict file is stuck — a crashed fixer is not a successful one", () => {
        const v = parseVerdict(null, sha);
        expect(v).toEqual({
            sha,
            outcome: "stuck",
            note: "the fixer wrote no verdict file",
        });
    });

    it("malformed JSON is stuck", () => {
        expect(parseVerdict("{ not json", sha).outcome).toBe("stuck");
        expect(parseVerdict("{ not json", sha).note).toMatch(/valid JSON/);
    });

    it("valid JSON that is not an object is stuck", () => {
        for (const raw of ["null", "42", '"landed"', '[{"outcome":"landed"}]'])
            expect(parseVerdict(raw, sha).outcome).toBe("stuck");
    });

    it("an unknown outcome string is stuck, and the note quotes it", () => {
        const v = parseVerdict(json({ sha, outcome: "fixed" }), sha);
        expect(v.outcome).toBe("stuck");
        expect(v.note).toMatch(/"fixed"/);
    });

    it("a missing outcome is stuck", () => {
        expect(parseVerdict(json({ sha }), sha).outcome).toBe("stuck");
    });

    it("a verdict about ANOTHER sha is stuck — a stale file cannot promote today's tip", () => {
        const v = parseVerdict(json({ sha: other, outcome: "landed" }), sha);
        expect(v.outcome).toBe("stuck");
        expect(v.note).toMatch(/dddddddd/);
        expect(v.note).toMatch(/cccccccc/);
    });

    it("a verdict naming no sha is stuck", () => {
        expect(parseVerdict(json({ outcome: "landed" }), sha).outcome).toBe(
            "stuck"
        );
        expect(
            parseVerdict(json({ sha: 42, outcome: "landed" }), sha).note
        ).toMatch(/no sha/);
    });

    it("always reports the sha it was ASKED about, never the one it read", () => {
        expect(
            parseVerdict(json({ sha: other, outcome: "landed" }), sha).sha
        ).toBe(sha);
        expect(parseVerdict(null, sha).sha).toBe(sha);
    });
});

describe("health:fix — the protocol issues #3200 and #3201 inherit", () => {
    it("puts the verdict beside last.json and the RED marker", () => {
        expect(verdictPath("/repo")).toBe(
            "/repo/.claude/telemetry/health/fix-verdict.json"
        );
    });

    it("spawns the session on the /health-fix skill, carrying the sha", () => {
        expect(claudeArgs("e".repeat(40))).toEqual([
            `/health-fix ${"e".repeat(40)}`,
        ]);
    });
});
