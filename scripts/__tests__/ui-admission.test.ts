// `check:ui` machine-wide admission (issue #4687). The decisions run in-process
// against a temp lock root; the EXIT PATHS run in real child processes, because
// "released on every exit path, including interruption" is a claim about
// process death that no in-process call can witness. Every child waits on an
// observable event (a printed line, an exit), never a wall-clock window.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    acquireUiLane,
    admitUiMachine,
    heavyHolderLive,
    heavyHolderRunning,
    MachineSaturatedError,
    readUiLaneOwner,
    uiLaneWhoLines,
} from "../lib/ui-admission";
import type { MachineSample } from "../lib/machine-admission";
import { viewportParallelism } from "../ui-gate/parallel";

let root: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-admission-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const lockDir = () => path.join(root, "ui.lock");

const inProcess = (
    extra: Partial<Parameters<typeof acquireUiLane>[0]> = {}
) => ({
    root,
    label: "check:ui test",
    announce: () => {},
    installExitHandlers: false,
    sleep: () => Promise.resolve(),
    ...extra,
});

describe("acquireUiLane — in process", () => {
    it("takes the lane, names its holder, and frees it on release", async () => {
        const hold = await acquireUiLane(inProcess({ pid: 4242, cwd: "/wt" }));
        expect(readUiLaneOwner(root)).toMatchObject({
            pid: 4242,
            cwd: "/wt",
            label: "check:ui test",
        });
        hold.release();
        expect(fs.existsSync(lockDir())).toBe(false);
        hold.release(); // idempotent
    });

    it("a second run waits, names the holder, and takes the lane once it is released", async () => {
        const first = await acquireUiLane(inProcess({ pid: 1001 }));
        const lines: string[] = [];
        let polls = 0;
        const second = await acquireUiLane(
            inProcess({
                pid: 1002,
                isAlive: () => true,
                announce: (l) => lines.push(l),
                sleep: async () => {
                    if (++polls === 2) first.release();
                },
            })
        );
        expect(polls).toBe(2);
        expect(lines[0]).toMatch(/waiting .* for the check:ui lane — pid 1001/);
        expect(lines.at(-1)).toMatch(/acquired the check:ui lane/);
        expect(readUiLaneOwner(root)?.pid).toBe(1002);
        second.release();
    });

    it("reclaims a lane whose holder is dead", async () => {
        await acquireUiLane(inProcess({ pid: 1001 }));
        const lines: string[] = [];
        const hold = await acquireUiLane(
            inProcess({
                pid: 1002,
                isAlive: () => false,
                announce: (l) => lines.push(l),
            })
        );
        expect(lines[0]).toMatch(/reclaiming the lane — holder is gone/);
        expect(readUiLaneOwner(root)?.pid).toBe(1002);
        hold.release();
    });

    it("reclaims a live holder that stopped heartbeating", async () => {
        let t = 1_000_000;
        await acquireUiLane(inProcess({ pid: 1001, now: () => t }));
        t += 60 * 60 * 1000;
        const lines: string[] = [];
        const hold = await acquireUiLane(
            inProcess({
                pid: 1002,
                now: () => t,
                isAlive: () => true,
                staleMs: 45 * 60 * 1000,
                announce: (l) => lines.push(l),
            })
        );
        expect(lines[0]).toMatch(/pid 1001 is alive but has not heartbeated/);
        hold.release();
    });

    it("never releases a lane another pid holds", async () => {
        const mine = await acquireUiLane(inProcess({ pid: 1001 }));
        fs.writeFileSync(
            path.join(lockDir(), "owner.json"),
            JSON.stringify({ ...readUiLaneOwner(root), pid: 9999 })
        );
        mine.release();
        expect(readUiLaneOwner(root)?.pid).toBe(9999);
    });
});

describe("uiLaneWhoLines", () => {
    it("says free when nobody holds it", () => {
        expect(uiLaneWhoLines(root)).toEqual(["[gate] check:ui lane is free"]);
    });

    it("names a live holder, and a dead one", async () => {
        await acquireUiLane(inProcess({ pid: 1001, cwd: "/wt-a" }));
        const live = uiLaneWhoLines(root, Date.now(), () => true).join("\n");
        expect(live).toMatch(/check:ui lane — pid 1001 .* \/wt-a/);
        expect(live).toMatch(/holder pid alive/);
        const dead = uiLaneWhoLines(root, Date.now(), () => false).join("\n");
        expect(dead).toMatch(/holder is dead/);
    });
});

describe("heavyHolderLive (issue #4941)", () => {
    const stamp = (owner: object) => {
        fs.mkdirSync(path.join(root, "gate.lock"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "gate.lock", "owner.json"),
            JSON.stringify(owner)
        );
    };
    const now = 10_000_000;
    const holder = {
        pid: 4242,
        label: "bun run oracle:compile",
        cwd: "/wt",
        ts: now - 1000,
    };

    it("is null when the heavy mutex is free", () => {
        expect(heavyHolderLive(root, {}, now, () => true)).toBeNull();
    });

    it("names a live, heartbeating holder", () => {
        stamp(holder);
        expect(heavyHolderLive(root, {}, now, () => true)?.pid).toBe(4242);
    });

    it("ignores a dead holder and one silent past the reclaim threshold", () => {
        stamp(holder);
        expect(heavyHolderLive(root, {}, now, () => false)).toBeNull();
        stamp({ ...holder, ts: now - 46 * 60 * 1000 });
        expect(heavyHolderLive(root, {}, now, () => true)).toBeNull();
    });

    it("ignores a holder that declared its stall past the short reclaim threshold (issue #4965)", () => {
        // The stamp is fresh; the declaration is what makes it reclaimable.
        stamp({ ...holder, stalledAt: now - 4 * 60 * 1000 });
        expect(heavyHolderLive(root, {}, now, () => true)?.pid).toBe(4242);
        stamp({ ...holder, stalledAt: now - 6 * 60 * 1000 });
        expect(heavyHolderLive(root, {}, now, () => true)).toBeNull();
    });

    it("ignores the hold this process runs under (TOLARIA_GATE_HELD=1)", () => {
        stamp(holder);
        expect(
            heavyHolderLive(root, { TOLARIA_GATE_HELD: "1" }, now, () => true)
        ).toBeNull();
    });
});

/**
 * Issue #4988 — `check:ui` asks the machine with no hold on the heavy mutex.
 * A heavy gate that is RUNNING keeps the 1-minute load over `machine.loadMax`
 * for its whole run, so waiting on that load is waiting for the holder to
 * finish; the lane's rule beside a holder is one viewport, not INFRA.
 */
describe("check:ui's machine admission beside a heavy holder (issue #4988)", () => {
    const T0 = 10_000_000;
    const T = { loadMax: 8, sessionBudgetMb: 2500, waitMaxS: 900 };
    const busy: MachineSample = {
        load1: 14.5,
        swapUsedMb: 6054,
        pressure: 1,
        reclaimableMb: 6400,
    };
    const stamp = (owner: object | null) => {
        fs.rmSync(path.join(root, "gate.lock"), {
            recursive: true,
            force: true,
        });
        if (owner === null) return;
        fs.mkdirSync(path.join(root, "gate.lock"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "gate.lock", "owner.json"),
            JSON.stringify(owner)
        );
    };
    /** A holder still waiting for the machine under its hold: it has
     *  spawned nothing, so its stamp carries no `childPid`. */
    const waiting = {
        pid: 4242,
        label: "bun scripts/land.ts 4985",
        cwd: "/wt",
        ts: T0,
    };
    /** …and past that wait: `gate.ts` stamps `childPid` at the spawn. */
    const running = { ...waiting, childPid: 4243 };

    /** The admission over a counted clock: `sleep` IS the clock, so a wait
     *  to the bound takes no wall time and a wait that should not happen is
     *  a count, not a race. The holder heartbeats as the clock moves. */
    const admit = async (sample: MachineSample, owner: object | null) => {
        let clock = T0;
        let sleeps = 0;
        const lines: string[] = [];
        stamp(owner);
        const out = await admitUiMachine({
            root,
            thresholds: T,
            announce: (l) => lines.push(l),
            env: {},
            isAlive: () => true,
            probe: () => sample,
            now: () => clock,
            sleep: async (ms) => {
                sleeps++;
                clock += ms;
                if (owner !== null) stamp({ ...owner, ts: clock });
            },
            pollMs: 5000,
        });
        return { out, lines, sleeps, waitedS: (clock - T0) / 1000 };
    };

    it("heavyHolderRunning: a live holder counts only once its command runs", () => {
        const at = (owner: object, env: NodeJS.ProcessEnv = {}) => {
            stamp(owner);
            return heavyHolderRunning(root, env, T0, () => true);
        };
        expect(at(running)?.pid).toBe(4242);
        // Still waiting for the machine under its hold: it runs nothing, the
        // load is not its own — though it IS live for the pool's sizing.
        expect(at(waiting)).toBeNull();
        expect(heavyHolderLive(root, {}, T0, () => true)?.pid).toBe(4242);
        // Declared its stall: a subtree burning no CPU raises no load.
        expect(at({ ...running, stalledAt: T0 - 60_000 })).toBeNull();
        expect(at(running, { TOLARIA_GATE_HELD: "1" })).toBeNull();
        stamp(running);
        expect(heavyHolderRunning(root, {}, T0, () => false)).toBeNull();
    });

    it("admits the walk beside a running holder, load over loadMax, at ONE viewport", async () => {
        const { out, lines, sleeps } = await admit(busy, running);
        expect(out.admitted).toBe(true);
        expect(out.beside?.pid).toBe(4242);
        expect(sleeps).toBe(0);
        expect(lines).toEqual([
            "[check:ui] machine busy — load 14.5, swap 6054 MB — beside a running heavy gate (pid 4242 · bun scripts/land.ts 4985): its load is not waited on",
        ]);
        // What `ui-gate/index.ts` sizes the pool from: the holder it was
        // admitted beside, even had it released since.
        stamp(null);
        expect(
            viewportParallelism(
                8,
                16 * 1024 ** 3,
                (out.beside ?? heavyHolderLive(root, {}, T0)) !== null
            )
        ).toBe(1);
    });

    it("with no holder the same load is waited to the bound, and nothing is walked", async () => {
        const { out, lines, waitedS } = await admit(busy, null);
        expect(out).toEqual({ admitted: false, beside: null });
        expect(waitedS).toBe(900);
        expect(lines.at(-1)).toMatch(
            /machine still busy after 900s .* INFRA \(machine-saturated\)/
        );
        // …which the lane turns into the saturated exit, lane given back.
        await expect(
            acquireUiLane(inProcess({ admitMachine: async () => out.admitted }))
        ).rejects.toBeInstanceOf(MachineSaturatedError);
        expect(fs.existsSync(lockDir())).toBe(false);
    });

    it("a holder still waiting for the machine explains no load: waited as if the mutex were free", async () => {
        const { out, waitedS } = await admit(busy, waiting);
        expect(out).toEqual({ admitted: false, beside: null });
        expect(waitedS).toBe(900);
    });

    it("memory pressure past normal waits beside a running holder too", async () => {
        const { out, lines, waitedS } = await admit(
            { ...busy, pressure: 2 },
            running
        );
        expect(out).toEqual({ admitted: false, beside: null });
        expect(waitedS).toBe(900);
        expect(lines[0]).toMatch(
            /machine busy — load 14\.5, swap 6054 MB \(memory pressure WARNING/
        );
    });

    it("a calm machine is admitted at full size, beside nobody", async () => {
        const { out, lines } = await admit({ ...busy, load1: 2.5 }, null);
        expect(out).toEqual({ admitted: true, beside: null });
        expect(lines).toEqual([]);
        expect(
            viewportParallelism(8, 16 * 1024 ** 3, out.beside !== null)
        ).toBeGreaterThan(1);
    });
});

// ── real processes: every exit path frees the lane ─────────────────────────
const LIB = path.resolve(__dirname, "../lib/ui-admission.ts");

function child(body: string) {
    const script = path.join(
        root,
        `child-${Math.random().toString(36).slice(2)}.ts`
    );
    fs.writeFileSync(
        script,
        `import { acquireUiLane } from ${JSON.stringify(LIB)};
await acquireUiLane({ root: ${JSON.stringify(root)}, label: "child", announce: () => {} });
console.log("HELD");
${body}
`
    );
    const proc = spawn("bun", [script], { stdio: ["ignore", "pipe", "pipe"] });
    const held = new Promise<void>((resolve, reject) => {
        let out = "";
        proc.stdout.on("data", (d) => {
            out += d;
            if (out.includes("HELD")) resolve();
        });
        proc.on("exit", () =>
            reject(new Error(`child exited before HELD: ${out}`))
        );
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) =>
            proc.on("exit", (code, signal) => resolve({ code, signal }))
    );
    return { proc, held, exited };
}

describe("acquireUiLane — every exit path frees the lane", () => {
    it.each([
        ["falling off the end", "", 0],
        ["process.exit(3)", "process.exit(3);", 3],
        ["an uncaught throw", 'throw new Error("boom");', 1],
    ])(
        "%s",
        async (_name, body, code) => {
            const c = child(body);
            expect((await c.exited).code).toBe(code);
            expect(fs.existsSync(lockDir())).toBe(false);
        },
        30_000
    );

    it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
        "%s while holding",
        async (sig) => {
            const c = child("await new Promise(() => {});");
            await c.held;
            expect(readUiLaneOwner(root)?.pid).toBe(c.proc.pid);
            c.proc.kill(sig);
            await c.exited;
            expect(fs.existsSync(lockDir())).toBe(false);
        },
        30_000
    );
});
