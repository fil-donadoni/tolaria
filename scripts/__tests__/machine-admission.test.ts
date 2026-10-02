import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    effectiveCap,
    gateAdmission,
    liveProjectSessions,
    memorySaturation,
    owningSession,
    parseEtime,
    parseLsofCwd,
    parseMachineConfig,
    parsePressure,
    parseProcRows,
    parseSwapUsage,
    parseVmStat,
    parseWorktreeRoots,
    runSaturated,
    saturation,
    sessionAdmission,
    sessionRefusal,
    subtreeRssMb,
    sustainedSample,
    timeoutOnlyFailure,
    waitForMachine,
    MACHINE_SATURATED_EXIT,
    type LiveSession,
    type MachineSample,
    type MachineThresholds,
} from "../lib/machine-admission";
import { infraCause, repeatedMachineTimeout } from "../lib/health-verdict";

/**
 * Machine admission (issue #4966) — the decisions, pure: what the machine
 * reads (load, memory, live sessions) → admit / wait / refuse. The spawned
 * halves (the gate's wait, the hook, `health-main`) are
 * `machine-admission-spawn.test.ts`.
 */
const T: MachineThresholds = {
    loadMax: 8,
    sessionBudgetMb: 2500,
    waitMaxS: 900,
};

const calm: MachineSample = {
    load1: 2.5,
    swapUsedMb: 6054,
    pressure: 1,
    reclaimableMb: 6400,
};

const session = (pid: number, cwd = "/repo"): LiveSession => ({
    pid,
    cwd,
    ageS: 600,
});

describe("machine config — thresholds are configuration, validated", () => {
    it("parses the repository's own machine block", () => {
        const raw = fs.readFileSync(
            path.resolve(__dirname, "..", "..", "tolaria.config.json"),
            "utf8"
        );
        const t = parseMachineConfig(raw);
        expect(Object.keys(t).sort()).toEqual([
            "loadMax",
            "sessionBudgetMb",
            "waitMaxS",
        ]);
    });

    it("refuses a missing block and a threshold that would refuse everything", () => {
        expect(() => parseMachineConfig("{}", "x.json")).toThrow(
            /missing "machine" object/
        );
        expect(() =>
            parseMachineConfig(
                '{"machine":{"loadMax":0,"sessionBudgetMb":2500,"waitMaxS":900}}',
                "x.json"
            )
        ).toThrow(/machine\.loadMax must be a positive number, got 0/);
        expect(() =>
            parseMachineConfig(
                '{"machine":{"loadMax":8,"sessionBudgetMb":2500}}',
                "x.json"
            )
        ).toThrow(/machine\.waitMaxS/);
    });
});

describe("probe parsers — the text each probe prints on this machine", () => {
    it("reads swap in use from `sysctl vm.swapusage`, in MB whatever the unit", () => {
        expect(
            parseSwapUsage(
                "total = 6144.00M  used = 4497.69M  free = 1646.31M  (encrypted)"
            )
        ).toBeCloseTo(4497.69);
        expect(
            parseSwapUsage("total = 8.00G  used = 1.50G  free = 6.50G")
        ).toBe(1536);
        expect(parseSwapUsage("no swap here")).toBeNull();
    });

    it("reads the kernel's pressure level, and nothing from an empty line", () => {
        expect(parsePressure("1\n")).toBe(1);
        expect(parsePressure("4")).toBe(4);
        expect(parsePressure("")).toBeNull();
        expect(parsePressure("unknown oid")).toBeNull();
    });

    it("reads free + inactive from `vm_stat`, at the page size it states", () => {
        const out = [
            "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
            "Pages free:                                3907.",
            "Pages active:                            265454.",
            "Pages inactive:                          264264.",
        ].join("\n");
        expect(parseVmStat(out)).toBeCloseTo(
            ((3907 + 264264) * 16384) / 1024 ** 2
        );
        expect(parseVmStat("Pages free: 1.")).toBeNull();
    });

    it("reads `ps` etime in every width it prints", () => {
        expect(parseEtime("09:31")).toBe(571);
        expect(parseEtime("01:02:03")).toBe(3723);
        expect(parseEtime("2-00:00:01")).toBe(172_801);
        expect(parseEtime("garbage")).toBeNull();
    });

    it("names a process by the basename of its command's first word", () => {
        const rows = parseProcRows(
            [
                "76045 75871       09:31 114320 /Users/f/.local/bin/claude",
                "76056 76045       09:31  57520 claude bg-pty-host",
                "  501     1    1-02:03:04   900 /sbin/launchd",
            ].join("\n")
        );
        expect(rows.map((r) => [r.pid, r.ppid, r.comm, r.rssKb])).toEqual([
            [76045, 75871, "claude", 114320],
            [76056, 76045, "claude", 57520],
            [501, 1, "launchd", 900],
        ]);
    });

    it("pairs each pid `lsof` prints with its cwd", () => {
        const cwds = parseLsofCwd(
            "p75871\nfcwd\nn/repo\np76045\nfcwd\nn/Users/f\n"
        );
        expect([...cwds]).toEqual([
            [75871, "/repo"],
            [76045, "/Users/f"],
        ]);
    });

    it("lists every checkout `git worktree list` names", () => {
        expect(
            parseWorktreeRoots(
                "worktree /repo\nHEAD abc\nbranch refs/heads/staging\n\nworktree /repo-issue-7\nHEAD def\n"
            )
        ).toEqual(["/repo", "/repo-issue-7"]);
    });
});

describe("the session census — who counts as a live project session", () => {
    // The process table measured on 2026-10-02: two terminal sessions, the
    // background daemon one of them started, its pty hosts, one spare that
    // was claimed (cwd in the project) and one that was not.
    const rows = parseProcRows(
        [
            "75871 73926 09:54 203312 claude",
            "76045 75871 09:46 113840 /Users/f/.local/bin/claude",
            "76056 76045 09:46  57568 claude bg-pty-host",
            "76065 76056 09:46 201056 claude bg-spare",
            "78581 76045 06:47  55472 claude bg-pty-host",
            "78591 78581 06:47  82592 claude bg-spare",
            "86087 73916 03:12 352736 claude",
            "99614 86087 00:01   4000 /bin/zsh",
            "99700 99614 00:01  60000 bun",
            "40000     1 05:00 300000 claude",
        ].join("\n")
    );
    const cwds = new Map([
        [75871, "/repo"],
        [76045, "/Users/f"],
        [76056, "/private/tmp/cc-daemon/spare"],
        [76065, "/repo"],
        [78581, "/private/tmp/cc-daemon/spare"],
        [78591, "/private/tmp/cc-daemon/spare"],
        [86087, "/repo-issue-7/scripts"],
        [40000, "/other-project"],
    ]);
    const roots = ["/repo", "/repo-issue-7"];

    it("counts a `claude` whose cwd is a checkout, and nothing else of that name", () => {
        expect(
            liveProjectSessions(rows, cwds, roots).map((s) => s.pid)
        ).toEqual([75871, 76065, 86087]);
    });

    it("does not count a sibling directory that merely shares the prefix", () => {
        const sessions = liveProjectSessions(
            rows,
            new Map([[75871, "/repo-other"]]),
            ["/repo"]
        );
        expect(sessions).toEqual([]);
    });

    it("finds the session a tool call runs in: its nearest `claude` ancestor", () => {
        expect(owningSession(rows, 99700)).toBe(86087);
        expect(owningSession(rows, 86087)).toBe(86087);
        expect(owningSession(rows, 501)).toBeNull();
    });

    it("sums a session's own tree, leaving out a session it spawned", () => {
        const all = new Set([75871, 76065, 86087]);
        expect(subtreeRssMb(rows, 86087, all)).toBeCloseTo(
            (352736 + 4000 + 60000) / 1024
        );
        // 75871's tree holds the daemon, both pty hosts and the unclaimed
        // spare — and NOT the claimed spare 76065, which is its own row.
        expect(subtreeRssMb(rows, 75871, all)).toBeCloseTo(
            (203312 + 113840 + 57568 + 55472 + 82592) / 1024
        );
    });
});

describe("gate admission — load/memory → admit / wait / refuse", () => {
    it("admits a calm machine, whatever its swap high-water mark", () => {
        expect(saturation(calm, T)).toEqual([]);
        expect(
            gateAdmission({ sample: calm, thresholds: T, waitedMs: 0 })
        ).toEqual({ verdict: "admit" });
    });

    it("waits while the 1-minute load is over machine.loadMax", () => {
        const busy = { ...calm, load1: 14.5 };
        expect(
            gateAdmission({ sample: busy, thresholds: T, waitedMs: 0 })
        ).toEqual({ verdict: "wait", reasons: ["load 14.5 > 8.0"] });
        // AT the threshold is admitted: loadMax is the highest calm reading.
        expect(
            gateAdmission({
                sample: { ...calm, load1: 8 },
                thresholds: T,
                waitedMs: 0,
            }).verdict
        ).toBe("admit");
    });

    it("waits while the kernel reports memory pressure", () => {
        expect(memorySaturation({ ...calm, pressure: 2 })).toEqual([
            "memory pressure WARNING (kernel level 2)",
        ]);
        expect(
            gateAdmission({
                sample: { ...calm, pressure: 4 },
                thresholds: T,
                waitedMs: 0,
            })
        ).toEqual({
            verdict: "wait",
            reasons: ["memory pressure CRITICAL (kernel level 4)"],
        });
    });

    it("refuses only once the wait has run its whole bound", () => {
        const busy = { ...calm, load1: 12 };
        expect(
            gateAdmission({ sample: busy, thresholds: T, waitedMs: 899_999 })
                .verdict
        ).toBe("wait");
        expect(
            gateAdmission({ sample: busy, thresholds: T, waitedMs: 900_000 })
        ).toEqual({ verdict: "refuse", reasons: ["load 12.0 > 8.0"] });
    });

    it("never saturates on a probe it could not read", () => {
        expect(
            saturation(
                {
                    load1: 1,
                    swapUsedMb: null,
                    pressure: null,
                    reclaimableMb: null,
                },
                T
            )
        ).toEqual([]);
    });
});

describe("session admission — sessions/memory → admit / refuse", () => {
    it("the effective cap is the ceiling while the RAM has room", () => {
        expect(
            effectiveCap({
                cap: 3,
                others: 1,
                reclaimableMb: 6400,
                sessionBudgetMb: 2500,
            })
        ).toBe(3);
    });

    it("the effective cap drops to what the RAM still holds", () => {
        // Two running, 2 GB reclaimable, 2.5 GB a session: no room for a third.
        expect(
            effectiveCap({
                cap: 3,
                others: 2,
                reclaimableMb: 2000,
                sessionBudgetMb: 2500,
            })
        ).toBe(2);
    });

    it("the effective cap is never below one, and an unread probe leaves the ceiling", () => {
        expect(
            effectiveCap({
                cap: 3,
                others: 0,
                reclaimableMb: 100,
                sessionBudgetMb: 2500,
            })
        ).toBe(1);
        expect(
            effectiveCap({
                cap: 3,
                others: 2,
                reclaimableMb: null,
                sessionBudgetMb: 2500,
            })
        ).toBe(3);
    });

    it("admits a session under the cap", () => {
        expect(
            sessionAdmission({
                others: [session(1), session(2)],
                cap: 3,
                sample: calm,
                thresholds: T,
                override: false,
            })
        ).toEqual({ verdict: "admit", effectiveCap: 3, overridden: [] });
    });

    it("refuses the fourth session: three others already fill the cap", () => {
        const d = sessionAdmission({
            others: [session(1), session(2), session(3)],
            cap: 3,
            sample: calm,
            thresholds: T,
            override: false,
        });
        expect(d).toEqual({
            verdict: "refuse",
            effectiveCap: 3,
            reasons: ["3 live project session(s) at the cap of 3"],
        });
    });

    it("refuses under the cap when the RAM has no room for another", () => {
        const d = sessionAdmission({
            others: [session(1), session(2)],
            cap: 3,
            sample: { ...calm, reclaimableMb: 2000 },
            thresholds: T,
            override: false,
        });
        expect(d.verdict).toBe("refuse");
        expect(d.effectiveCap).toBe(2);
        expect(d.verdict === "refuse" && d.reasons[0]).toMatch(
            /no RAM for another — effective cap 2 of 3 \(reclaimable 2000 MB, 2500 MB per session\)/
        );
    });

    it("refuses under memory pressure beside another session, never the only one, and never on load", () => {
        expect(
            sessionAdmission({
                others: [session(1)],
                cap: 3,
                sample: { ...calm, pressure: 2 },
                thresholds: T,
                override: false,
            })
        ).toMatchObject({
            verdict: "refuse",
            reasons: ["memory pressure WARNING (kernel level 2)"],
        });
        // Alone, it is the session that would relieve the pressure.
        expect(
            sessionAdmission({
                others: [],
                cap: 3,
                sample: { ...calm, pressure: 4 },
                thresholds: T,
                override: false,
            }).verdict
        ).toBe("admit");
        // A `land` mid-gate holds the load over loadMax by design: a session
        // opened beside it adds none, and is admitted.
        expect(
            sessionAdmission({
                others: [session(1)],
                cap: 3,
                sample: { ...calm, load1: 13 },
                thresholds: T,
                override: false,
            }).verdict
        ).toBe("admit");
    });

    it("a pressure reading must be sustained: the calmest of three stands", () => {
        const readings = [2, 2, 1].map((pressure) => ({ ...calm, pressure }));
        let i = 0;
        const pauses: number[] = [];
        const s = sustainedSample(
            () => readings[i++],
            (ms) => pauses.push(ms)
        );
        expect(s.pressure).toBe(1);
        expect(pauses).toEqual([500, 500]);
        // A calm first reading is taken once; a level that holds is kept.
        i = 2;
        expect(
            sustainedSample(
                () => readings[i++],
                () => {}
            ).pressure
        ).toBe(1);
        expect(i).toBe(3);
        expect(
            sustainedSample(
                () => ({ ...calm, pressure: 2 }),
                () => {}
            ).pressure
        ).toBe(2);
    });

    it("the override admits, and carries what it overrode", () => {
        expect(
            sessionAdmission({
                others: [session(1), session(2), session(3)],
                cap: 3,
                sample: calm,
                thresholds: T,
                override: true,
            })
        ).toEqual({
            verdict: "admit",
            effectiveCap: 3,
            overridden: ["3 live project session(s) at the cap of 3"],
        });
    });

    it("the refusal names every live session and the one escape", () => {
        const text = sessionRefusal(
            ["3 live project session(s) at the cap of 3"],
            [session(11, "/repo"), session(22, "/repo-issue-7")]
        );
        expect(text).toContain("pid 11 · /repo · up 10m");
        expect(text).toContain("pid 22 · /repo-issue-7 · up 10m");
        expect(text).toContain("TOLARIA_OVER_CAP=1 claude");
    });
});

describe("waitForMachine — the bounded wait", () => {
    let ticks = 0;
    const drive = async (
        samples: MachineSample[],
        env: NodeJS.ProcessEnv = {}
    ) => {
        let clock = 0;
        let i = 0;
        const lines: string[] = [];
        const result = await waitForMachine({
            thresholds: { ...T, waitMaxS: 60 },
            tag: "[gate]",
            announce: (l) => lines.push(l),
            probe: () => samples[Math.min(i++, samples.length - 1)],
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
            pollMs: 5000,
            env,
            tick: () => ticks++,
        });
        return { result, lines, polls: i, ticks };
    };

    it("admits at once, and silently, on a calm machine", async () => {
        const { result, lines } = await drive([calm]);
        expect(result).toMatchObject({ admitted: true, waitedMs: 0 });
        expect(lines).toEqual([]);
    });

    it("waits out a busy machine and says what it waited on", async () => {
        const busy = { ...calm, load1: 14.5 };
        const { result, lines } = await drive([busy, busy, calm]);
        expect(result).toMatchObject({ admitted: true, waitedMs: 10_000 });
        expect(lines[0]).toBe(
            "[gate] machine busy — load 14.5, swap 6054 MB (load 14.5 > 8.0); waiting, bound 60s"
        );
        expect(lines.at(-1)).toMatch(/^\[gate\] machine calm after 10s/);
    });

    it("gives the run up at the bound — refused, never started", async () => {
        const busy = { ...calm, load1: 14.5 };
        const before = ticks;
        const { result, lines, polls } = await drive([busy]);
        expect(result).toMatchObject({
            admitted: false,
            overridden: false,
            waitedMs: 60_000,
            reasons: ["load 14.5 > 8.0"],
        });
        expect(polls).toBe(13); // one per 5 s, the 13th at the bound
        expect(ticks - before).toBe(13); // the holder's stamp, every poll
        expect(lines.at(-1)).toMatch(
            /machine still busy after 60s .* INFRA \(machine-saturated\)/
        );
    });

    it("starts anyway under the GATE's own override, and says so", async () => {
        const { result, lines } = await drive([{ ...calm, load1: 14.5 }], {
            TOLARIA_GATE_SATURATED_OK: "1",
        });
        expect(result).toMatchObject({ admitted: true, overridden: true });
        expect(lines[0]).toMatch(
            /starting anyway: TOLARIA_GATE_SATURATED_OK=1/
        );
    });

    it("the SESSION's override does not start a gate", async () => {
        // A session admitted past the cap passes TOLARIA_OVER_CAP to every
        // gate it runs; they still wait for the machine.
        const { result } = await drive([{ ...calm, load1: 14.5 }], {
            TOLARIA_OVER_CAP: "1",
        });
        expect(result).toMatchObject({ admitted: false, overridden: false });
    });
});

describe("verdict hygiene — what a saturated machine may explain", () => {
    // What vitest prints for a run that failed only by timing out (the shape
    // of the health log of tip a15195d8): four tests, each over its 60 s
    // ceiling, nothing else.
    const timeouts = [
        " Test Files  4 failed | 287 passed (291)",
        "      Tests  4 failed | 3405 passed | 3 skipped (3412)",
        " FAIL  |bot-node| a.bot.test.ts > x",
        "Error: Test timed out in 60000ms.",
        " FAIL  |bot-node| b.bot.test.ts > x",
        "Error: Test timed out in 60000ms.",
        " FAIL  |bot-node| c.bot.test.ts > x",
        "Error: Test timed out in 60000ms.",
        " FAIL  |bot-node| d.bot.test.ts > x",
        "Error: Test timed out in 60000ms.",
    ].join("\n");
    const mixed = timeouts.replace(
        "Error: Test timed out in 60000ms.",
        "AssertionError: expected 1 to be 2"
    );
    const step = {
        ok: false,
        startedAt: 1000,
        lastSleepAt: null,
        step: "test",
        exitCode: 1,
    };

    it("a run is saturated when any of its samples is", () => {
        expect(runSaturated([calm, { ...calm, load1: 12 }], T)).toBe(true);
        expect(runSaturated([calm, calm], T)).toBe(false);
        expect(runSaturated([null, null], T)).toBe(false);
    });

    it("tells a timeout-only failure from one with a real assertion in it", () => {
        expect(timeoutOnlyFailure(timeouts)).toBe(true);
        expect(timeoutOnlyFailure(mixed)).toBe(false);
        expect(timeoutOnlyFailure("error TS2322: nope")).toBe(false);
    });

    it("reads each failed test's own error, not two counts over the output", () => {
        // Two failed: one timeout whose message is printed twice, one real
        // assertion. Counting timeout lines against failures reads 2 >= 2.
        const twice = [
            "      Tests  2 failed | 10 passed (12)",
            " FAIL  |node| a.test.ts > x",
            "Error: Test timed out in 60000ms.",
            "stderr | a.test.ts > x: Error: Test timed out in 60000ms.",
            " FAIL  |node| b.test.ts > y",
            "AssertionError: expected 1 to be 2",
        ].join("\n");
        expect(timeoutOnlyFailure(twice)).toBe(false);
        // A failed test with no block of its own is one nothing vouches for.
        expect(
            timeoutOnlyFailure(
                [
                    "      Tests  2 failed | 10 passed (12)",
                    " FAIL  |node| a.test.ts > x",
                    "Error: Test timed out in 60000ms.",
                ].join("\n")
            )
        ).toBe(false);
    });

    it("timeouts on a saturated machine are INFRA, machine-timeout", () => {
        expect(
            infraCause({ ...step, output: timeouts, machineSaturated: true })
        ).toBe("machine-timeout");
    });

    it("the excuse is the machine's ONCE: the same step timing out again is the tree's", () => {
        const first = {
            status: "infra" as const,
            infraCause: "machine-timeout",
            failedStep: "test",
        };
        expect(repeatedMachineTimeout(first, "test")).toBe(true);
        expect(repeatedMachineTimeout(first, "check:all")).toBe(false);
        expect(repeatedMachineTimeout(null, "test")).toBe(false);
        // A gate that never started excuses nothing about the next run.
        expect(
            repeatedMachineTimeout(
                { ...first, infraCause: "machine-saturated" },
                "test"
            )
        ).toBe(false);
        expect(
            repeatedMachineTimeout({ ...first, status: "green" }, "test")
        ).toBe(false);
    });

    it("the same timeouts on a calm machine stay RED", () => {
        expect(
            infraCause({ ...step, output: timeouts, machineSaturated: false })
        ).toBeNull();
    });

    it("an assertion that failed beside the timeouts stays RED, saturated or not", () => {
        expect(
            infraCause({ ...step, output: mixed, machineSaturated: true })
        ).toBeNull();
    });

    it("a gate that never started — the saturated exit — is INFRA on any step", () => {
        expect(
            infraCause({
                ...step,
                exitCode: MACHINE_SATURATED_EXIT,
                output: "",
            })
        ).toBe("machine-saturated");
        expect(
            infraCause({
                ...step,
                step: "check:ui --all",
                exitCode: MACHINE_SATURATED_EXIT,
                output: "",
            })
        ).toBe("machine-saturated");
    });
});
