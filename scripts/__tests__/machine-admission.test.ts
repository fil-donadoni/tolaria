import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    consumerLines,
    effectiveCap,
    gateAdmission,
    liveProjectSessions,
    machineWaitRow,
    memorySaturation,
    owningSession,
    parseCpuRows,
    parseEtime,
    parseLsofCwd,
    parseMachineConfig,
    parseMeminfo,
    parsePressure,
    parseProcRows,
    parseSwapUsage,
    parseVmStat,
    parseWorktreeRoots,
    psiLevel,
    processOwner,
    runSaturated,
    saturation,
    sessionAdmission,
    sessionRefusal,
    subtreeRssMb,
    sustainedSample,
    timeoutOnlyFailure,
    topConsumers,
    waitForMachine,
    MACHINE_SATURATED_EXIT,
    type ConsumerSnapshot,
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

    it("reads swap in use and MemAvailable from Linux `/proc/meminfo`, in MB (issue #5305)", () => {
        const out = [
            "MemTotal:       32617888 kB",
            "MemFree:         1203364 kB",
            "MemAvailable:   18874368 kB",
            "SwapTotal:       8388604 kB",
            "SwapFree:        6291452 kB",
        ].join("\n");
        expect(parseMeminfo(out)).toEqual({
            swapUsedMb: (8388604 - 6291452) / 1024,
            reclaimableMb: 18874368 / 1024,
        });
        expect(parseMeminfo("MemTotal: 1 kB")).toEqual({
            swapUsedMb: null,
            reclaimableMb: null,
        });
    });

    it("translates Linux PSI onto the kernel pressure scale: 1 normal, 2 warning, 4 critical (issue #5305)", () => {
        const psi = (some: number, full: number): string =>
            [
                `some avg10=${some.toFixed(2)} avg60=0.00 avg300=0.00 total=123`,
                `full avg10=${full.toFixed(2)} avg60=0.00 avg300=0.00 total=45`,
            ].join("\n");
        expect(psiLevel(psi(0, 0))).toBe(1);
        expect(psiLevel(psi(9.99, 0))).toBe(1);
        expect(psiLevel(psi(10, 0))).toBe(2);
        expect(psiLevel(psi(40, 9.99))).toBe(2);
        expect(psiLevel(psi(40, 10))).toBe(4);
        // A kernel without `full` (pre-5.13 cgroup v1 roots) still reads.
        expect(psiLevel("some avg10=12.00 avg60=0 avg300=0 total=1")).toBe(2);
        expect(psiLevel("")).toBeNull();
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

    it("beside a running heavy holder the load is the holder's: only memory saturates (issue #4988)", () => {
        const busy = { ...calm, load1: 14.5 };
        // Past the bound, and still admitted: the load is not the reason.
        expect(
            gateAdmission({
                sample: busy,
                thresholds: T,
                waitedMs: 900_000,
                besideHolder: true,
            })
        ).toEqual({ verdict: "admit" });
        expect(
            gateAdmission({
                sample: { ...busy, pressure: 2 },
                thresholds: T,
                waitedMs: 0,
                besideHolder: true,
            })
        ).toEqual({
            verdict: "wait",
            reasons: ["memory pressure WARNING (kernel level 2)"],
        });
        expect(
            gateAdmission({
                sample: { ...busy, pressure: 2 },
                thresholds: T,
                waitedMs: 900_000,
                besideHolder: true,
            }).verdict
        ).toBe("refuse");
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
        env: NodeJS.ProcessEnv = {},
        /** The running heavy holder at each poll (the last entry repeats);
         *  absent, the caller names none — the heavy tier's own wait. */
        holders?: (string | null)[]
    ) => {
        let clock = 0;
        let i = 0;
        let h = 0;
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
            heavyHolder:
                holders && (() => holders[Math.min(h++, holders.length - 1)]),
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

    const HOLDER = "pid 4242 · bun scripts/land.ts 4985";

    it("does not wait on a running heavy holder's load, and names the holder (issue #4988)", async () => {
        // The load never drops: beside a 35-minute hold it would not.
        const { result, lines, polls } = await drive(
            [{ ...calm, load1: 14.5 }],
            {},
            [HOLDER]
        );
        expect(result).toMatchObject({
            admitted: true,
            overridden: false,
            waitedMs: 0,
            beside: HOLDER,
        });
        expect(polls).toBe(1);
        expect(lines).toEqual([
            `[gate] machine busy — load 14.5, swap 6054 MB — beside a running heavy gate (${HOLDER}): its load is not waited on`,
        ]);
    });

    it("with no running holder the same load still runs out the bound — refused", async () => {
        const { result, polls } = await drive([{ ...calm, load1: 14.5 }], {}, [
            null,
        ]);
        expect(result).toMatchObject({
            admitted: false,
            waitedMs: 60_000,
            reasons: ["load 14.5 > 8.0"],
            beside: null,
        });
        expect(polls).toBe(13);
    });

    it("memory pressure waits beside a holder too, to the bound", async () => {
        const { result, lines } = await drive(
            [{ ...calm, load1: 14.5, pressure: 2 }],
            {},
            [HOLDER]
        );
        expect(result).toMatchObject({
            admitted: false,
            waitedMs: 60_000,
            reasons: ["memory pressure WARNING (kernel level 2)"],
            beside: null,
        });
        expect(lines[0]).toBe(
            "[gate] machine busy — load 14.5, swap 6054 MB (memory pressure WARNING (kernel level 2)); waiting, bound 60s"
        );
    });

    it("a holder that finishes during the wait stops explaining the load", async () => {
        const busy = { ...calm, load1: 14.5 };
        const { result, lines, polls } = await drive(
            // Pressure beside the holder; then the holder is gone and the
            // load is nobody's; then the machine calms.
            [{ ...busy, pressure: 2 }, busy, busy, calm],
            {},
            [HOLDER, null]
        );
        expect(polls).toBe(4);
        expect(result).toMatchObject({
            admitted: true,
            waitedMs: 15_000,
            beside: null,
        });
        expect(lines.at(-1)).toMatch(/^\[gate\] machine calm after 15s/);
    });

    it("a calm machine beside a holder is admitted in silence, beside nobody", async () => {
        const { result, lines } = await drive([calm], {}, [HOLDER]);
        expect(result).toMatchObject({ admitted: true, beside: null });
        expect(lines).toEqual([]);
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

describe("the consumers — who holds the load (issue #4989)", () => {
    // `ps -axo pid=,ppid=,pcpu=,etime=,args=` as this machine prints it: a
    // session (76889) running a gate (900) whose vitest (901) burns CPU, a
    // detached health run (700, reparented to launchd) and its walk (701),
    // and Spotlight, which is nobody's.
    const PS = [
        "    1     0   0.0 15-00:13:00 /sbin/launchd",
        "  414     1  52.0 15-00:07:00 /System/Library/Frameworks/CoreServices.framework/mds_stores",
        "76889 76219  18.5    01:00:38 claude",
        "  900 76889   0.4       02:10 bun scripts/gate.ts heavy bun run check:all:inner",
        "  901   900 398,5       02:09 node /repo/node_modules/.bin/vitest run",
        "  700     1   0.1       10:00 bun /repo/scripts/health-main.ts 05b5f80a",
        "  701   700  88.0       01:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless",
        "  555 55060   0.0       00:01 ps -axo pid=,ppid=,pcpu=,etime=,args=",
        "55060     1   2.1    04:55:29 claude",
        "garbage line",
    ].join("\n");
    const rows = parseCpuRows(PS);
    const sessions = new Set([76889]);

    it("parses every row, the command whole and a decimal comma as a point", () => {
        expect(rows).toHaveLength(9);
        expect(rows.find((r) => r.pid === 901)).toMatchObject({
            ppid: 900,
            cpu: 398.5,
            ageS: 129,
        });
        expect(rows.find((r) => r.pid === 701)!.args).toBe(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless"
        );
    });

    it("labels a process with its project session and its gate run", () => {
        expect(processOwner(rows, 901, sessions)).toBe(
            "session pid 76889 · gate.ts pid 900"
        );
        // A detached health run has a gate and no session.
        expect(processOwner(rows, 701, sessions)).toBe(
            "health-main.ts pid 700"
        );
        // Another project's session, and the system, are nobody's.
        expect(processOwner(rows, 555, sessions)).toBeNull();
        expect(processOwner(rows, 414, sessions)).toBeNull();
        // A pid that is its own parent ends the walk.
        expect(
            processOwner(
                [{ pid: 5, ppid: 5, cpu: 1, ageS: 1, args: "x" }],
                5,
                sessions
            )
        ).toBeNull();
    });

    it("names the top consumers by CPU, never a process at 0%", () => {
        const top = topConsumers(rows, sessions, 3);
        expect(top.map((c) => [c.pid, c.owner])).toEqual([
            [901, "session pid 76889 · gate.ts pid 900"],
            [701, "health-main.ts pid 700"],
            [414, null],
        ]);
        expect(topConsumers(rows, sessions, 99).some((c) => c.cpu === 0)).toBe(
            false
        );
    });

    it("prints one line per consumer, owned or outside the project", () => {
        const snap: ConsumerSnapshot = {
            consumers: topConsumers(rows, sessions, 3),
            ownersRead: true,
        };
        expect(consumerLines(snap)).toEqual([
            "   399% pid 901 (ppid 900, up 2m) node /repo/node_modules/.bin/vitest run — session pid 76889 · gate.ts pid 900",
            "    88% pid 701 (ppid 700, up 1m) /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless — health-main.ts pid 700",
            "    52% pid 414 (ppid 1, up 360h07m) /System/Library/Frameworks/CoreServices.framework/mds_stores — outside the project",
        ]);
    });

    it("says `owner unread` when the sessions could not be read, never `outside`", () => {
        const [line] = consumerLines({
            consumers: topConsumers(rows, new Set(), 3).slice(2),
            ownersRead: false,
        });
        expect(line).toMatch(/mds_stores — owner unread$/);
    });

    it("says `consumers unreadable` for a probe that could not be read", () => {
        expect(consumerLines(null)).toEqual(["  consumers unreadable"]);
    });

    it("cuts a long command to the line's width", () => {
        const [line] = consumerLines({
            consumers: [
                {
                    pid: 1,
                    ppid: 0,
                    cpu: 50,
                    ageS: 5,
                    command: "x".repeat(300),
                    owner: null,
                },
            ],
            ownersRead: true,
        });
        expect(line).toContain(`${"x".repeat(99)}… — outside the project`);
        expect(line).not.toContain("x".repeat(100));
    });
});

describe("waitForMachine — the consumers a busy wait names (issue #4989)", () => {
    const TOP: ConsumerSnapshot = {
        consumers: [
            {
                pid: 901,
                ppid: 900,
                cpu: 398.5,
                ageS: 129,
                command: "node vitest run",
                owner: "session pid 76889 · gate.ts pid 900",
            },
        ],
        ownersRead: true,
    };
    const run = async (
        samples: MachineSample[],
        consumers: () => ConsumerSnapshot | null,
        extra: { env?: NodeJS.ProcessEnv; holder?: string } = {}
    ) => {
        let clock = 0;
        let i = 0;
        let probes = 0;
        const lines: string[] = [];
        const rows: Record<string, unknown>[] = [];
        const result = await waitForMachine({
            thresholds: { ...T, waitMaxS: 180 },
            tag: "[gate]",
            announce: (l) => lines.push(l),
            probe: () => samples[Math.min(i++, samples.length - 1)],
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
            pollMs: 5000,
            env: extra.env ?? {},
            consumers: () => {
                probes++;
                return consumers();
            },
            record: (row) => rows.push(row),
            heavyHolder: extra.holder ? () => extra.holder! : undefined,
        });
        return { result, lines, rows, probes, polls: i };
    };
    const at = (load1: number): MachineSample => ({ ...calm, load1 });

    it("a busy line carries the consumers of its sample", async () => {
        const { lines } = await run([at(14.5), calm], () => TOP);
        expect(lines[0].split("\n")).toEqual([
            "[gate] machine busy — load 14.5, swap 6054 MB (load 14.5 > 8.0); waiting, bound 180s",
            "   399% pid 901 (ppid 900, up 2m) node vitest run — session pid 76889 · gate.ts pid 900",
        ]);
    });

    it("probes once per announced line, never once per poll", async () => {
        // 25 polls over two minutes of waiting: three announced lines.
        const busy = Array.from({ length: 25 }, () => at(14.5));
        const { probes, polls, lines } = await run([...busy, calm], () => TOP);
        expect(polls).toBe(26);
        expect(lines.filter((l) => l.includes("machine busy"))).toHaveLength(3);
        expect(probes).toBe(3);
    });

    it("an unreadable or throwing probe prints `consumers unreadable` and the wait goes on", async () => {
        for (const consumers of [
            () => null,
            () => {
                throw new Error("ps timed out");
            },
        ]) {
            const { result, lines } = await run([at(14.5), calm], consumers);
            expect(lines[0].split("\n")[1]).toBe("  consumers unreadable");
            expect(result).toMatchObject({ admitted: true, waitedMs: 5000 });
        }
    });

    it("a saturated wait leaves ONE row: its peak load and that sample's consumers", async () => {
        const low: ConsumerSnapshot = { consumers: [], ownersRead: true };
        let n = 0;
        // Announced at 0 s (9.1), 60 s (63.3), 120 s (33.6); then calm.
        const samples = [
            at(9.1),
            ...Array.from({ length: 11 }, () => at(20)),
            at(63.3),
            ...Array.from({ length: 11 }, () => at(40)),
            at(33.6),
            calm,
        ];
        const { rows, result } = await run(samples, () =>
            n++ === 1 ? TOP : low
        );
        expect(result.peak?.sample.load1).toBe(63.3);
        expect(rows).toEqual([
            {
                event: "machine-wait",
                tag: "[gate]",
                outcome: "admitted",
                waited_ms: 125_000,
                peak_load: 63.3,
                max_load: 63.3,
                peak_at_ms: 60_000,
                peak_swap_mb: 6054,
                peak_pressure: 1,
                peak_reasons: ["load 63.3 > 8.0"],
                owners_read: true,
                consumers: [
                    {
                        pid: 901,
                        ppid: 900,
                        cpu: 398.5,
                        age_s: 129,
                        cmd: "node vitest run",
                        owner: "session pid 76889 · gate.ts pid 900",
                    },
                ],
            },
        ]);
    });

    it("a spike between two announced lines is still the row's `max_load`", async () => {
        // Announced at 0 s (9.1) and 60 s (12); 61.2 at 30 s was never announced.
        const samples = [
            at(9.1),
            ...Array.from({ length: 5 }, () => at(20)),
            at(61.2),
            ...Array.from({ length: 5 }, () => at(20)),
            at(12),
            calm,
        ];
        const { rows } = await run(samples, () => TOP);
        expect(rows).toMatchObject([{ peak_load: 12, max_load: 61.2 }]);
    });

    it("the refusing poll counts toward `max_load`", async () => {
        const samples = [
            at(9.1),
            ...Array.from({ length: 35 }, () => at(10)),
            at(70),
        ];
        const { rows } = await run(samples, () => TOP);
        expect(rows).toMatchObject([{ outcome: "refused", max_load: 70 }]);
    });

    it("a refused wait records `refused`; an overridden one `overridden`", async () => {
        const refused = await run([at(14.5)], () => TOP);
        expect(refused.rows).toMatchObject([{ outcome: "refused" }]);
        const over = await run([at(14.5)], () => TOP, {
            env: { TOLARIA_GATE_SATURATED_OK: "1" },
        });
        expect(over.lines[0]).toContain("399% pid 901");
        expect(over.rows).toMatchObject([{ outcome: "overridden" }]);
    });

    it("a calm wait, and one admitted beside a holder, record nothing", async () => {
        expect((await run([calm], () => TOP)).rows).toEqual([]);
        const beside = await run([at(14.5)], () => TOP, {
            holder: "pid 4242 · bun scripts/land.ts 4985",
        });
        // The busy line still names who holds the load…
        expect(beside.lines[0]).toContain("399% pid 901");
        // …but nothing was waited on.
        expect(beside.rows).toEqual([]);
        expect(machineWaitRow("[gate]", beside.result)).toBeNull();
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
