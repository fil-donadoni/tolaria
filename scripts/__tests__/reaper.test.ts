import { describe, expect, it } from "vitest";
import type { ProcessLease } from "../lib/process-lease";
import {
    parseEnvTags,
    parsePsRows,
    planSweep,
    unitOfCgroup,
    type ProcRow,
} from "../reaper";

// The active reaper (issue #5470), judged on a FAKE process table: every rule
// that decides a kill — and every rule that must spare — is a pure function
// of (rows, leases, now), so each is pinned here without signalling anything.

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const UID = 501;
const SELF = 9000;

const row = (p: Partial<ProcRow> & { pid: number }): ProcRow => ({
    ppid: 1,
    pgid: p.pid,
    uid: UID,
    ageS: 600,
    command: "sh -c true",
    owner: null,
    ...p,
});

const lease = (p: Partial<ProcessLease> & { id: string; pid: number }) =>
    ({
        kind: "gate-run",
        pidStart: NOW_S - 600,
        pgid: null,
        command: "check:lane",
        cwd: "/wt/live",
        cwdMayVanish: false,
        parent: null,
        startedAt: NOW - 600_000,
        renewedAt: NOW - 600_000,
        deadline: NOW + 3_600_000,
        graceUntil: null,
        ...p,
    }) as ProcessLease;

/** The reaper itself, under a shell under launchd. */
const selfRows = [
    row({ pid: 8999, command: "/bin/sh -c bun scripts/reaper.ts" }),
    row({ pid: SELF, ppid: 8999, command: "bun scripts/reaper.ts" }),
];

const plan = (
    rows: ProcRow[],
    leases: ProcessLease[],
    cwdExists: (p: string) => boolean = (p) => !p.startsWith("/wt/gone")
) =>
    planSweep({
        rows: [...selfRows, ...rows],
        leases,
        nowMs: NOW,
        selfPid: SELF,
        uid: UID,
        cwdExists,
        scopeRoots: ["/repo"],
    });

const killed = (p: ReturnType<typeof plan>) =>
    p.kills.map((k) => k.pid).sort((a, b) => a - b);

describe("reaper — dead leases", () => {
    it("expired lease: anchor, tagged members and their descendants are reaped", () => {
        const p = plan(
            [
                row({ pid: 100, command: "sh scripts/gate-run.sh check:lane" }),
                row({
                    pid: 101,
                    ppid: 100,
                    pgid: 100,
                    owner: "L1",
                    command: "bun run check:lane",
                }),
                // Re-parented orphan: only the tag still ties it to L1.
                row({
                    pid: 102,
                    ppid: 1,
                    pgid: 102,
                    owner: "L1",
                    command: "node vitest/dist/workers/forks.js",
                }),
                // Env unreadable (a macOS platform binary): the tree finds it.
                row({
                    pid: 103,
                    ppid: 102,
                    pgid: 102,
                    command: "/bin/sleep 1000",
                }),
            ],
            [lease({ id: "L1", pid: 100, deadline: NOW - 1000 })]
        );
        expect(killed(p)).toEqual([100, 101, 102, 103]);
        expect(p.kills.find((k) => k.pid === 102)?.reason).toMatch(
            /tagged with lease L1: the lease expired/
        );
    });

    it("missing cwd: a removed worktree kills the tree; a self-removing spawner is spared", () => {
        const p = plan(
            [
                row({ pid: 200, owner: null }),
                row({ pid: 201, ppid: 200, owner: "Lgone" }),
                row({ pid: 210, owner: null }),
                row({ pid: 211, ppid: 210, owner: "Lland" }),
            ],
            [
                lease({ id: "Lgone", pid: 200, cwd: "/wt/gone-1" }),
                lease({
                    id: "Lland",
                    pid: 210,
                    cwd: "/wt/gone-2",
                    cwdMayVanish: true,
                }),
            ]
        );
        expect(killed(p)).toEqual([200, 201]);
        expect(p.kills[0].reason).toMatch(/cwd \/wt\/gone-1 no longer exists/);
    });

    it("dead owner: the anchor gone, its tagged orphans die; its process group too", () => {
        const p = plan(
            [
                row({
                    pid: 301,
                    ppid: 1,
                    pgid: 300,
                    owner: "Lpass",
                    command: "python3 -c import time; time.sleep(1e6)",
                }),
                row({
                    pid: 302,
                    ppid: 1,
                    pgid: 300,
                    owner: null,
                    command: "/bin/sleep 999",
                }),
                row({
                    pid: 303,
                    ppid: 1,
                    pgid: 303,
                    owner: null,
                    command: "/bin/sleep 999",
                }),
            ],
            [lease({ id: "Lpass", pid: 300, pgid: 300 })]
        );
        expect(killed(p)).toEqual([301, 302]);
        expect(p.kills.find((k) => k.pid === 301)?.reason).toMatch(
            /anchor pid 300 is gone/
        );
    });

    it("a recycled anchor pid is NOT the anchor: the new tenant survives, the tagged members do not", () => {
        const p = plan(
            [
                row({ pid: 400, ageS: 5, pgid: 400, command: "Safari" }),
                row({ pid: 401, ppid: 1, pgid: 401, owner: "Lold" }),
                row({ pid: 402, ppid: 400, pgid: 400, owner: null }),
            ],
            [lease({ id: "Lold", pid: 400, pgid: 400 })]
        );
        expect(killed(p)).toEqual([401]);
    });

    it("a lease under a dead parent lease is dead too (fixpoint)", () => {
        const p = plan(
            [
                row({
                    pid: 501,
                    owner: "Lpass",
                    command: "bun scripts/gate.ts light vitest",
                }),
                row({ pid: 502, ppid: 501, owner: "Lgate" }),
            ],
            [
                lease({ id: "Lpass", pid: 500 }),
                lease({
                    id: "Lgate",
                    pid: 501,
                    pidStart: NOW_S - 600,
                    parent: "Lpass",
                }),
            ]
        );
        expect(killed(p)).toEqual([501, 502]);
        expect(
            p.verdicts.find((v) => v.lease.id === "Lgate")?.verdict
        ).toMatchObject({
            alive: false,
            why: expect.stringMatching(/parent lease Lpass is dead/),
        });
    });

    it("a tag naming no registered lease is reaped past the race margin, not before", () => {
        const p = plan(
            [
                row({ pid: 600, owner: "Lnobody", ageS: 500 }),
                row({ pid: 601, owner: "Lfresh", ageS: 3 }),
                row({ pid: 602, owner: "Llive" }),
            ],
            [lease({ id: "Llive", pid: 602 })]
        );
        expect(killed(p)).toEqual([600]);
    });

    it("an EMPTY registry beside tagged processes reaps none of them (a registry read in the wrong place)", () => {
        const p = plan([row({ pid: 650, owner: "Lnobody", ageS: 5000 })], []);
        expect(killed(p)).toEqual([]);
    });

    it("a self-renewing lease past its deadline is alive while its anchor runs (a blocked loop, a slept machine)", () => {
        const p = plan(
            [row({ pid: 660 }), row({ pid: 661, ppid: 1, owner: "Lself" })],
            [
                lease({
                    id: "Lself",
                    pid: 660,
                    deadline: NOW - 3_600_000,
                    expires: false,
                }),
            ]
        );
        expect(killed(p)).toEqual([]);
        expect(p.verdicts[0].verdict.alive).toBe(true);
    });
});

describe("reaper — what it spares", () => {
    it("legitimate re-attach: a lease inside its grace window is spared even past its deadline and anchor", () => {
        const p = plan(
            [row({ pid: 701, ppid: 1, owner: "Lre", command: "node vitest" })],
            [
                lease({
                    id: "Lre",
                    pid: 700,
                    deadline: NOW - 60_000,
                    graceUntil: NOW + 60_000,
                }),
            ]
        );
        expect(killed(p)).toEqual([]);
        expect(p.verdicts[0].verdict).toEqual({ alive: true, why: "grace" });
    });

    it("a live detached gate parented to a dead pass's waiter survives the pass", () => {
        const p = plan(
            [
                // The waiter — `sh gate-run.sh` — still the runner's parent.
                row({
                    pid: 800,
                    owner: "Lpass",
                    command: "sh scripts/gate-run.sh land 12",
                }),
                // The runner: born with the pass's tag, anchored by its own lease.
                row({ pid: 801, ppid: 800, pgid: 801, owner: "Lpass" }),
                row({
                    pid: 802,
                    ppid: 801,
                    pgid: 801,
                    owner: "Lrun",
                    command: "bun run land 12",
                }),
            ],
            [
                lease({ id: "Lpass", pid: 799 }),
                lease({ id: "Lrun", pid: 801, pgid: 801 }),
            ]
        );
        expect(killed(p)).toEqual([800]);
    });

    it("never itself, its ancestors, pid 1, another uid, or a unit's tree", () => {
        const p = plan(
            [
                row({ pid: 1, ppid: 0, command: "launchd" }),
                row({
                    pid: 900,
                    uid: 0,
                    owner: "Ldead",
                    command: "node vitest",
                }),
                row({
                    pid: 901,
                    owner: "unit:convex-local",
                    command: "convex-local-backend",
                }),
                // The reaper's own ancestor carries a dead tag — still spared.
                { ...selfRows[0], owner: "Ldead" },
            ],
            [lease({ id: "Ldead", pid: 899, deadline: NOW - 1 })]
        );
        expect(killed(p)).toEqual([]);
    });
});

describe("reaper — the pattern net for untagged strays", () => {
    it("an untagged orphan of this checkout matching a tooling pattern past the age threshold is reaped", () => {
        const p = plan(
            [
                // Scoped by its cwd (a sibling worktree shares the prefix).
                row({
                    pid: 1000,
                    ppid: 1,
                    cwd: "/repo-issue-12",
                    command:
                        "/Users/x/Library/Caches/ms-playwright/chromium-1140/chrome-mac/Chromium --headless",
                }),
                // Scoped by its command path.
                row({
                    pid: 1001,
                    ppid: 1,
                    command:
                        "node /repo/node_modules/vitest/dist/workers/forks.js",
                }),
                row({
                    pid: 1002,
                    ppid: 1,
                    command: "bun /repo/scripts/ui-gate/index.ts",
                }),
                row({
                    pid: 1003,
                    ppid: 1,
                    cwd: "/repo",
                    command: "claude --session-id x -p /next-ticket 5",
                }),
                row({
                    pid: 1005,
                    ppid: 1,
                    command: "node /repo/node_modules/.bin/vite --port 5199",
                }),
            ],
            []
        );
        expect(killed(p)).toEqual([1000, 1001, 1002, 1003, 1005]);
        expect(p.kills[0].reason).toMatch(
            /untagged orphan matching 'playwright chromium'/
        );
    });

    it("spares a match that is young, has a live parent, is another project's, is a service, or matches nothing", () => {
        const p = plan(
            [
                row({
                    pid: 1100,
                    ppid: 1,
                    ageS: 30,
                    command: "node /repo/vitest",
                }),
                row({ pid: 1101, ppid: 4242, command: "node /repo/vitest" }),
                row({ pid: 4242, ppid: 4241, command: "-zsh" }),
                row({
                    pid: 1102,
                    ppid: 1,
                    command: "/Applications/Slack.app/Contents/MacOS/Slack",
                }),
                row({ pid: 1103, ppid: 1, command: "claude --resume" }),
                // Another project's orphan: outside the scope.
                row({
                    pid: 1104,
                    ppid: 1,
                    cwd: "/other",
                    command: "node /other/node_modules/.bin/vite",
                }),
                // The backend convex:ensure leaves serving on purpose.
                row({
                    pid: 1105,
                    ppid: 1,
                    command: "/repo/.convex/convex-local-backend --port 3210",
                }),
                // A unit's process: systemd or launchd ends it, never us.
                row({
                    pid: 1106,
                    ppid: 1,
                    owner: "unit:tolaria-health.service",
                    command: "bun /repo/scripts/health-main.ts",
                }),
            ],
            []
        );
        expect(killed(p)).toEqual([]);
    });

    it("an orphan re-parented to a systemd --user subreaper counts as an orphan", () => {
        const p = plan(
            [
                row({
                    pid: 1200,
                    ppid: 1,
                    command: "/usr/lib/systemd/systemd --user",
                }),
                row({
                    pid: 1201,
                    ppid: 1200,
                    cwd: "/repo",
                    command: "node vitest/dist/workers/forks.js",
                }),
            ],
            []
        );
        expect(killed(p)).toEqual([1201]);
    });
});

describe("reaper — process table parsing", () => {
    it("reads a systemd unit's ownership from its cgroup, never the user manager's", () => {
        expect(
            unitOfCgroup(
                "0::/user.slice/user-1000.slice/user@1000.service/app.slice/tolaria-health.service\n"
            )
        ).toBe("tolaria-health.service");
        expect(unitOfCgroup("0::/system.slice/tolaria-convex.service")).toBe(
            "tolaria-convex.service"
        );
        expect(
            unitOfCgroup("0::/user.slice/user-1000.slice/user@1000.service")
        ).toBeNull();
        expect(
            unitOfCgroup("0::/user.slice/user-1000.slice/session-3.scope")
        ).toBeNull();
    });
    it("parses ps rows with day-long etime and keeps the full command", () => {
        expect(
            parsePsRows(
                "  12     1    12   501 1-02:03:04 /bin/sh -c a b\n  13 12 12 501 00:07 x\n"
            )
        ).toEqual([
            {
                pid: 12,
                ppid: 1,
                pgid: 12,
                uid: 501,
                ageS: 93784,
                command: "/bin/sh -c a b",
            },
            { pid: 13, ppid: 12, pgid: 12, uid: 501, ageS: 7, command: "x" },
        ]);
    });

    it("reads the tag from the trailing environment, not from an argument", () => {
        const tags = parseEnvTags(
            "  7 bun -e TOLARIA_OWNER=arg HOME=/u TOLARIA_OWNER=gate-run-1 PATH=/bin\n  8 sleep 9\n"
        );
        expect([...tags]).toEqual([[7, "gate-run-1"]]);
    });
});
