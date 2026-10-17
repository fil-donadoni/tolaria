import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    claudeArgs,
    extraClaudeArgs,
    planLine,
    spawnDecision,
} from "../health-fix";
import {
    decodeFixStatus,
    encodeFixDescription,
    FIX_CONTEXT,
    githubFixAttemptStore,
    LANDED_WAIT_MAX_MS,
    LOOP_FIX_ATTEMPTS,
    loopFixDecision,
    type FixAttempt,
} from "../lib/health-fix-attempts";
import { HEALTH_DIR_REL, type GhRunner } from "../lib/health-verdict-store";
import { DEFAULT_FIX_ATTEMPTS } from "../release";

/**
 * `health:fix --headless` and the loop's repair decision (issue #5589): a RED
 * the unattended loop can repair without a TTY, at most once per tip, with
 * every attempt on the verdict's pivot so the other machine sees it.
 */
const SHA = "a".repeat(40);
const NOW = Date.parse("2026-10-14T12:00:00Z");

describe("health:fix --headless — no TTY needed", () => {
    const base = {
        redMarker: true,
        last: { sha: SHA, status: "red" as const, failedStep: "test" },
        tip: SHA,
        interactive: false,
    };

    it("spawns with no terminal when headless", () => {
        expect(spawnDecision({ ...base, headless: true }).kind).toBe("spawn");
    });

    it("still refuses with no terminal when not headless, naming --headless", () => {
        const d = spawnDecision(base);
        expect(d).toMatchObject({ kind: "refuse", nothingToFix: false });
        expect(d.kind === "refuse" && d.reason).toMatch(/--headless/);
    });

    it("headless never spawns on a tree with nothing red", () => {
        expect(
            spawnDecision({ ...base, redMarker: false, headless: true })
        ).toMatchObject({ kind: "refuse", nothingToFix: true });
    });

    it("spawns `claude -p` on the skill's headless mode with the loop's flags", () => {
        expect(
            claudeArgs(SHA, {
                headless: true,
                extra: extraClaudeArgs([
                    "--headless",
                    "--claude-args=--permission-mode  bypassPermissions",
                ]),
            })
        ).toEqual([
            "-p",
            `/health-fix ${SHA} --headless`,
            "--permission-mode",
            "bypassPermissions",
        ]);
        // The interactive argv is unchanged.
        expect(claudeArgs(SHA)).toEqual([`/health-fix ${SHA}`]);
        expect(extraClaudeArgs(["--headless"])).toEqual([]);
    });
});

describe("loopFixDecision — one attempt per tip, bounded", () => {
    const at = (outcome: FixAttempt["outcome"], ageMs = 0): FixAttempt => ({
        sha: SHA,
        outcome,
        machine: "MacBook",
        at: new Date(NOW - ageMs).toISOString(),
        pr: 42,
        note: "n",
    });
    const decide = (record: FixAttempt | null, attemptsThisRun = 0) =>
        loopFixDecision({ record, attemptsThisRun, max: 3, now: NOW });

    it("no record → attempt, until the run's bound", () => {
        expect(decide(null)).toEqual({ kind: "attempt" });
        expect(decide(null, 3)).toMatchObject({
            kind: "stop",
            why: expect.stringMatching(/bound/),
        });
    });

    it("a record for the tip is never re-attempted, whoever wrote it", () => {
        expect(decide(at("stuck")).kind).toBe("stop");
        expect(decide(at("attempting")).kind).toBe("stop");
    });

    it("landed → wait for health on the repair's tip, then stop past the batch window", () => {
        expect(decide(at("landed"))).toMatchObject({
            kind: "wait",
            why: expect.stringMatching(/PR #42/),
        });
        expect(decide(at("landed", LANDED_WAIT_MAX_MS + 1)).kind).toBe("stop");
    });

    it("an unreadable record stops — never a second fixer it cannot see", () => {
        expect(
            loopFixDecision({
                record: null,
                error: "HTTP 502",
                attemptsThisRun: 0,
                max: 3,
                now: NOW,
            })
        ).toMatchObject({ kind: "stop", why: expect.stringMatching(/502/) });
        expect(
            planLine(
                () => ({
                    backend: "github",
                    read: () => {
                        throw new Error("HTTP 502");
                    },
                    write: () => {},
                }),
                SHA,
                0,
                NOW
            )
        ).toMatch(/^stop: .*502/);
    });

    it("the bound is release's", () => {
        expect(LOOP_FIX_ATTEMPTS).toBe(DEFAULT_FIX_ATTEMPTS);
    });
});

describe("the fix-attempt record — on the pivot", () => {
    let dir: string | undefined;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("round-trips through a commit status description", () => {
        const a: FixAttempt = {
            sha: SHA,
            outcome: "landed",
            machine: "MacBook",
            pr: 5591,
            note: "pinned ui-walk · gating",
        };
        const desc = encodeFixDescription(a);
        expect(desc).toBe(
            "LANDED · MacBook · PR #5591 · pinned ui-walk · gating"
        );
        expect(
            decodeFixStatus({
                sha: SHA,
                state: "success",
                description: desc,
                createdAt: null,
            })
        ).toEqual(a);
        expect(
            encodeFixDescription({ ...a, note: "x".repeat(300) }).length
        ).toBe(140);
    });

    it("github: writes and reads `context=health-fix-attempt` on the red sha", () => {
        const statuses: Array<Record<string, string>> = [];
        const run: GhRunner = (args) => {
            if (args.includes("POST")) {
                const f = (k: string) =>
                    args
                        .find((x) => x.startsWith(`${k}=`))!
                        .slice(k.length + 1);
                statuses.unshift({
                    context: f("context"),
                    state: f("state"),
                    description: f("description"),
                    created_at: "2026-10-14T00:00:00Z",
                });
                return { status: 0, stdout: "{}", stderr: "" };
            }
            return { status: 0, stdout: JSON.stringify(statuses), stderr: "" };
        };
        const store = githubFixAttemptStore({ repo: "o/r", run });
        expect(store.read(SHA)).toBeNull();
        store.write({ sha: SHA, outcome: "attempting", machine: "MacBook" });
        store.write({
            sha: SHA,
            outcome: "stuck",
            machine: "MacBook",
            note: "no repro",
        });
        expect(statuses[0].context).toBe(FIX_CONTEXT);
        expect(store.read(SHA)).toMatchObject({
            outcome: "stuck",
            note: "no repro",
        });
    });
});
