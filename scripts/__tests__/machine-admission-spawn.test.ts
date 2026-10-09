import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { INFRA_REMEDY, PREFLIGHT_MACHINE_STEP } from "../lib/health-verdict";
import { MACHINE_SATURATED_EXIT } from "../lib/machine-admission";
import { acquireUiLane, MachineSaturatedError } from "../lib/ui-admission";
import {
    EMPTY_CADENCE,
    MAX_BATCH_AGE_MS,
    serializeCadence,
} from "../lib/health-cadence";

/**
 * Machine admission, driven for real (issue #4966): the gate's bounded wait,
 * the `run` row, and a whole `health-main` on a machine
 * that never calms. Every child reads an INJECTED probe
 * (`TOLARIA_MACHINE_PROBE`) and a bound in milliseconds — the one exception is
 * the `run` row, which must carry the real machine's numbers.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE = path.join(REPO_ROOT, "scripts", "gate.ts");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");
const HEALTH_CADENCE = path.join(REPO_ROOT, "scripts", "health-cadence.ts");

const BUSY = JSON.stringify({
    load1: 14.5,
    swapUsedMb: 6054,
    pressure: 1,
    reclaimableMb: 6400,
    sessions: [],
});
const probe = (sessions: unknown[], extra: object = {}) =>
    JSON.stringify({
        load1: 1,
        swapUsedMb: 0,
        pressure: 1,
        reclaimableMb: 16_384,
        sessions,
        ...extra,
    });

let tmp: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-machine-"));
});

afterEach(() => {
    fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

/** The gate's environment: its own lock root, no inherited hold, a wait
 *  bounded in milliseconds. */
function gateEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        TOLARIA_GATE_LOCK_ROOT: path.join(tmp, "locks"),
        TOLARIA_ALLOW_FULL_SUITE: "1",
        TOLARIA_MACHINE_WAIT_MAX_MS: "300",
        TOLARIA_MACHINE_POLL_MS: "50",
        CLAUDE_PROJECT_DIR: tmp,
        ...extra,
    };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_GATE_SATURATED_OK;
    for (const [k, v] of Object.entries(extra)) if (v === "") delete env[k];
    return env;
}

const runGate = (tier: string, command: string, env: NodeJS.ProcessEnv) =>
    spawnSync("bun", [GATE, tier, command], {
        cwd: tmp,
        env,
        encoding: "utf8",
        timeout: 30_000,
    });

describe("gate.ts — nothing heavy starts on a saturated machine (issue #4966)", () => {
    it("waits, then exits the saturated code having run nothing, and frees the mutex", () => {
        const ran = path.join(tmp, "ran");
        const r = runGate(
            "heavy",
            `touch ${ran}`,
            gateEnv({ TOLARIA_MACHINE_PROBE: BUSY })
        );
        expect(r.status).toBe(MACHINE_SATURATED_EXIT);
        expect(r.stderr).toContain(
            "[gate] machine busy — load 14.5, swap 6054 MB (load 14.5 > 8.0); waiting"
        );
        expect(r.stderr).toMatch(
            /machine still busy .* INFRA \(machine-saturated\)/
        );
        expect(fs.existsSync(ran)).toBe(false);
        expect(fs.existsSync(path.join(tmp, "locks", "gate.lock"))).toBe(false);
        // The refusal is on record, with the machine it was refused on.
        const rows = fs
            .readFileSync(
                path.join(tmp, ".claude", "telemetry", "gate-lock.jsonl"),
                "utf8"
            )
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(rows.at(-1)).toMatchObject({
            event: "machine-saturated",
            load: 14.5,
            reasons: ["load 14.5 > 8.0"],
        });
    });

    it("the `job` and `yield` spellings wait the same way", () => {
        for (const tier of ["job", "yield"]) {
            const ran = path.join(tmp, `ran-${tier}`);
            const r = runGate(
                tier,
                `touch ${ran}`,
                gateEnv({ TOLARIA_MACHINE_PROBE: BUSY })
            );
            expect(r.status, tier).toBe(MACHINE_SATURATED_EXIT);
            expect(fs.existsSync(ran), tier).toBe(false);
        }
    });

    it("the light tier and a nested call do not ask", () => {
        const light = path.join(tmp, "light");
        expect(
            runGate(
                "light",
                `touch ${light}`,
                gateEnv({ TOLARIA_MACHINE_PROBE: BUSY })
            ).status
        ).toBe(0);
        expect(fs.existsSync(light)).toBe(true);

        const nested = path.join(tmp, "nested");
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: BUSY });
        env.TOLARIA_GATE_HELD = "1";
        expect(runGate("heavy", `touch ${nested}`, env).status).toBe(0);
        expect(fs.existsSync(nested)).toBe(true);
    });

    it("a session admitted past the cap does not carry its override into its gates", () => {
        const ran = path.join(tmp, "ran");
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: BUSY });
        env.TOLARIA_OVER_CAP = "1";
        expect(runGate("heavy", `touch ${ran}`, env).status).toBe(
            MACHINE_SATURATED_EXIT
        );
        expect(fs.existsSync(ran)).toBe(false);
    });

    it("TOLARIA_GATE_SATURATED_OK=1 starts on the saturated machine, announced and logged", () => {
        const ran = path.join(tmp, "ran");
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: BUSY });
        env.TOLARIA_GATE_SATURATED_OK = "1";
        const r = runGate("heavy", `touch ${ran}`, env);
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(
            /machine busy .* starting anyway: TOLARIA_GATE_SATURATED_OK=1/
        );
        expect(fs.existsSync(ran)).toBe(true);
        expect(
            fs.readFileSync(
                path.join(tmp, ".claude", "telemetry", "gate-lock.jsonl"),
                "utf8"
            )
        ).toContain('"event":"machine-override"');
    });

    it("every run records the load and swap it started and ended on", () => {
        // The REAL probes: an injected sample logs no row. The light tier, so
        // the real machine's load cannot hold this test.
        const r = runGate(
            "light",
            "true",
            gateEnv({ TOLARIA_MACHINE_PROBE: "" })
        );
        expect(r.status).toBe(0);
        const row = fs
            .readFileSync(
                path.join(tmp, ".claude", "telemetry", "gate-lock.jsonl"),
                "utf8"
            )
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>)
            .find((l) => l.event === "run");
        expect(row).toBeDefined();
        expect(row).toMatchObject({ tier: "light", exit: 0 });
        for (const key of ["load_start", "load_end"])
            expect(typeof row![key], key).toBe("number");
        // Present on every platform; a number where the platform says.
        for (const key of ["swap_start_mb", "swap_end_mb"])
            expect(row, key).toHaveProperty(key);
        if (process.platform === "darwin" || process.platform === "linux")
            expect(typeof row!.swap_start_mb).toBe("number");
    });
});

describe("gate.ts — a run whose command removes the gate's own cwd (issue #4984)", () => {
    // `land` deletes the worktree its gate runs in. The `run` row is written
    // after that, so a telemetry root read from the cwd at the END recreated
    // the deleted worktree, and the end sample's probes — spawned from a cwd
    // that no longer existed — read null.
    const git = (args: string[], cwd: string): void => {
        const r = spawnSync("git", args, {
            cwd,
            encoding: "utf8",
            timeout: 20_000,
        });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };

    it("writes the row to the primary checkout, with a real end sample, and does not recreate the worktree", () => {
        const primary = fs.realpathSync(tmp) + "/primary";
        const worktree = fs.realpathSync(tmp) + "/primary-issue-7";
        git(["init", "-q", primary], tmp);
        git(
            [
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "tip",
            ],
            primary
        );
        git(["worktree", "add", "-q", worktree, "-b", "feat/x"], primary);

        // The real probes (an injected sample logs no row), the light tier
        // (so the real machine cannot hold the test), and no session: the
        // root must come from the checkout, as it does under `gate:run`.
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: "" });
        delete env.CLAUDE_PROJECT_DIR;
        const r = spawnSync("bun", [GATE, "light", `rm -rf ${worktree}`], {
            cwd: worktree,
            env,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status).toBe(0);
        expect(fs.existsSync(worktree)).toBe(false);
        const row = fs
            .readFileSync(
                path.join(primary, ".claude", "telemetry", "gate-lock.jsonl"),
                "utf8"
            )
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>)
            .find((l) => l.event === "run");
        expect(row).toMatchObject({ tier: "light", exit: 0, cwd: worktree });
        expect(typeof row!.load_end).toBe("number");
        if (process.platform === "darwin" || process.platform === "linux") {
            expect(typeof row!.swap_end_mb).toBe("number");
            // Linux reads pressure from PSI, absent on a kernel without it.
            if (
                process.platform === "darwin" ||
                fs.existsSync("/proc/pressure/memory")
            )
                expect(typeof row!.pressure_end).toBe("number");
        }
    });

    it("never resurrects a telemetry root that is gone", () => {
        // No checkout to fall back to: the root IS the cwd, and it is deleted.
        const scratch = path.join(fs.realpathSync(tmp), "scratch");
        fs.mkdirSync(scratch);
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: "" });
        delete env.CLAUDE_PROJECT_DIR;
        const r = spawnSync("bun", [GATE, "light", `rm -rf ${scratch}`], {
            cwd: scratch,
            env,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status).toBe(0);
        expect(fs.existsSync(scratch)).toBe(false);
    });
});

describe("check:ui lane — the lane is not the machine (issue #4966)", () => {
    it("gives the lane back and throws when the machine never calms", async () => {
        const root = path.join(tmp, "locks");
        await expect(
            acquireUiLane({
                root,
                label: "check:ui --all",
                announce: () => {},
                installExitHandlers: false,
                admitMachine: async () => false,
            })
        ).rejects.toBeInstanceOf(MachineSaturatedError);
        expect(fs.existsSync(path.join(root, "ui.lock"))).toBe(false);
    });

    it("keeps the lane when the machine is admitted", async () => {
        const root = path.join(tmp, "locks");
        const hold = await acquireUiLane({
            root,
            label: "check:ui --all",
            announce: () => {},
            installExitHandlers: false,
            admitMachine: async () => true,
        });
        expect(fs.existsSync(path.join(root, "ui.lock"))).toBe(true);
        hold.release();
    });
});

describe("health-main — a saturated machine is INFRA, never RED (issue #4966)", () => {
    const git = (args: string[], cwd: string): string => {
        const r = spawnSync("git", args, {
            cwd,
            encoding: "utf8",
            timeout: 20_000,
        });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r.stdout.trim();
    };

    /** A scratch primary checkout whose `origin` carries the base branch. */
    const scratchPrimary = (): { primary: string; tip: string } => {
        const bare = path.join(tmp, "origin.git");
        const primary = path.join(tmp, "primary");
        git(["init", "-q", "--bare", bare], tmp);
        git(["init", "-q", "-b", BASE_BRANCH, primary], tmp);
        git(
            [
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "tip",
            ],
            primary
        );
        git(["remote", "add", "origin", bare], primary);
        git(["push", "-q", "origin", BASE_BRANCH], primary);
        return { primary, tip: git(["rev-parse", "HEAD"], primary) };
    };

    /** A machine that never calms, a bound in milliseconds, no hold. */
    const busyEnv = (): NodeJS.ProcessEnv => {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            TOLARIA_GATE_LOCK_ROOT: path.join(tmp, "locks"),
            TOLARIA_MACHINE_PROBE: BUSY,
            TOLARIA_MACHINE_WAIT_MAX_MS: "300",
            TOLARIA_MACHINE_POLL_MS: "50",
            // No deployment configured: the Convex preflight has nothing to
            // probe, and the machine is asked next.
            VITE_CONVEX_URL: "",
        };
        delete env.TOLARIA_GATE_HELD;
        delete env.TOLARIA_GATE_SATURATED_OK;
        delete env.CLAUDE_PROJECT_DIR;
        return env;
    };

    it("the batch gate's path: `gate.ts yield` never starts, and the cadence writes the infra record health-main could not", () => {
        const { primary, tip } = scratchPrimary();
        const dir = path.join(primary, ".claude", "telemetry", "health");
        fs.mkdirSync(dir, { recursive: true });
        // One landing, un-healthed past MAX_BATCH_AGE_MS: past the batch's age bound,
        // so `detach` fires.
        fs.writeFileSync(
            path.join(dir, "cadence.json"),
            serializeCadence({
                ...EMPTY_CADENCE,
                landings: [
                    {
                        sha: tip,
                        at: Date.now() - MAX_BATCH_AGE_MS - 3600 * 1000,
                    },
                ],
            })
        );
        const r = spawnSync("bun", [HEALTH_CADENCE, "detach"], {
            cwd: primary,
            env: busyEnv(),
            encoding: "utf8",
            timeout: 45_000,
        });
        expect(r.stderr).toContain("[gate] machine busy — load 14.5");
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last).toMatchObject({
            sha: tip,
            status: "infra",
            failedStep: PREFLIGHT_MACHINE_STEP,
            infraCause: "machine-saturated",
            reason: INFRA_REMEDY["machine-saturated"],
        });
        expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        expect(fs.readdirSync(dir).filter((f) => f.endsWith(".log"))).toEqual(
            []
        );
    }, 60_000);

    it("waits, then records infra / machine-saturated at preflight:machine — no RED marker, no gate run", () => {
        const { primary } = scratchPrimary();
        const env = busyEnv();
        const r = spawnSync("bun", [HEALTH_MAIN], {
            cwd: primary,
            env,
            encoding: "utf8",
            // A run that went on to the gates would far outlive this.
            timeout: 45_000,
        });
        const dir = path.join(primary, ".claude", "telemetry", "health");

        expect(r.status).toBe(1);
        expect(r.stderr).toContain("health-main: machine busy — load 14.5");
        expect(r.stderr).toMatch(/INFRA @ \w+ at preflight:machine/);
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_MACHINE_STEP,
            infraCause: "machine-saturated",
            reason: INFRA_REMEDY["machine-saturated"],
        });
        expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        expect(fs.readdirSync(dir).filter((f) => f.endsWith(".log"))).toEqual(
            []
        );
    }, 60_000);

    it("beside a RUNNING heavy gate the same load is not waited on: the run goes past preflight:machine (issue #4988)", () => {
        const { primary } = scratchPrimary();
        const env = busyEnv();
        // The heavy mutex as `gate.ts` leaves it once its command runs; the
        // pid is this process — alive, as a real holder is.
        const lock = path.join(tmp, "locks", "gate.lock");
        fs.mkdirSync(lock, { recursive: true });
        fs.writeFileSync(
            path.join(lock, "owner.json"),
            JSON.stringify({
                pid: process.pid,
                label: "bun scripts/land.ts 4985",
                cwd: "/wt",
                ts: Date.now(),
                childPid: process.pid,
            })
        );
        const r = spawnSync("bun", [HEALTH_MAIN], {
            cwd: primary,
            env,
            encoding: "utf8",
            // The scratch checkout has no scripts: the first gate fails at
            // once. A run that waited on the machine instead ends INFRA.
            timeout: 45_000,
        });
        const dir = path.join(primary, ".claude", "telemetry", "health");

        expect(r.stderr).toContain(
            `health-main: machine busy — load 14.5, swap 6054 MB — beside a running heavy gate (pid ${process.pid} · bun scripts/land.ts 4985): its load is not waited on`
        );
        expect(r.stderr).not.toMatch(/at preflight:machine/);
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last.failedStep).not.toBe(PREFLIGHT_MACHINE_STEP);
        expect(last.infraCause).not.toBe("machine-saturated");
    }, 60_000);
});
describe("the consumers, driven for real (issue #4989)", () => {
    const MACHINE = path.join(REPO_ROOT, "scripts", "machine.ts");
    const CONSUMERS = [
        {
            pid: 901,
            ppid: 900,
            cpu: 398.5,
            ageS: 129,
            command: "node vitest run",
            owner: "session pid 76889 · gate.ts pid 900",
        },
    ];
    const BUSY_NAMED = JSON.stringify({
        ...JSON.parse(BUSY),
        consumers: CONSUMERS,
    });
    const LINE =
        "   399% pid 901 (ppid 900, up 2m) node vitest run — session pid 76889 · gate.ts pid 900";

    it("a gate's busy wait names the consumers and records its peak with them", () => {
        const r = runGate(
            "heavy",
            "true",
            gateEnv({ TOLARIA_MACHINE_PROBE: BUSY_NAMED })
        );
        expect(r.status).toBe(MACHINE_SATURATED_EXIT);
        expect(r.stderr).toContain(
            `[gate] machine busy — load 14.5, swap 6054 MB (load 14.5 > 8.0); waiting, bound 0s\n${LINE}`
        );
        const rows = fs
            .readFileSync(
                path.join(tmp, ".claude", "telemetry", "gate-lock.jsonl"),
                "utf8"
            )
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>)
            .filter((l) => l.event === "machine-wait");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            tier: "heavy",
            outcome: "refused",
            peak_load: 14.5,
            consumers: [{ pid: 901, owner: CONSUMERS[0].owner }],
        });
    });

    it("an unreadable probe says so, and the wait runs exactly as before", () => {
        const r = runGate(
            "heavy",
            "true",
            gateEnv({ TOLARIA_MACHINE_PROBE: BUSY })
        );
        expect(r.status).toBe(MACHINE_SATURATED_EXIT);
        expect(r.stderr).toContain("waiting, bound 0s\n  consumers unreadable");
    });

    it("`bun run machine` lists the consumers when a threshold reads over", () => {
        const r = spawnSync("bun", [MACHINE], {
            cwd: tmp,
            env: { ...process.env, TOLARIA_MACHINE_PROBE: BUSY_NAMED },
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/ {2}top consumers {4}\(probe \d+ ms\)\n/);
        expect(r.stdout).toContain(`  ${LINE}`);
    });

    it("`bun run machine` prints nothing extra on a calm machine", () => {
        const r = spawnSync("bun", [MACHINE], {
            cwd: tmp,
            env: {
                ...process.env,
                TOLARIA_MACHINE_PROBE: probe([], { consumers: CONSUMERS }),
            },
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("a gate start     is admitted");
        expect(r.stdout).not.toContain("consumers");
        expect(r.stdout).not.toContain("pid 901");
    });

    it("the live probe answers from a cwd that has been removed (the class of issue #4974)", () => {
        const gone = path.join(fs.realpathSync(tmp), "gone");
        fs.mkdirSync(gone);
        const script = `import { readConsumers } from ${JSON.stringify(path.join(REPO_ROOT, "scripts", "lib", "machine-admission.ts"))};
require("fs").rmSync(${JSON.stringify(gone)}, { recursive: true });
const s = readConsumers({});
console.log(JSON.stringify({ ok: s !== null, n: s?.consumers.length ?? -1 }));`;
        const env = { ...process.env };
        delete env.TOLARIA_MACHINE_PROBE;
        const r = spawnSync("bun", ["-e", script], {
            cwd: gone,
            env,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status, r.stderr).toBe(0);
        expect(fs.existsSync(gone)).toBe(false);
        expect(JSON.parse(r.stdout.trim())).toMatchObject({ ok: true });
    });
});
