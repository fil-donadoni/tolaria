import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { INFRA_REMEDY, PREFLIGHT_MACHINE_STEP } from "../lib/health-verdict";
import { MACHINE_SATURATED_EXIT } from "../lib/machine-admission";
import { acquireUiLane, MachineSaturatedError } from "../lib/ui-admission";

/**
 * Machine admission, driven for real (issue #4966): the gate's bounded wait,
 * the `run` row, the session hook, and a whole `health-main` on a machine
 * that never calms. Every child reads an INJECTED probe
 * (`TOLARIA_MACHINE_PROBE`) and a bound in milliseconds — the one exception is
 * the `run` row, which must carry the real machine's numbers.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATE = path.join(REPO_ROOT, "scripts", "gate.ts");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");
const HOOK = path.join(REPO_ROOT, ".claude", "hooks", "session-admission.sh");

const BUSY = JSON.stringify({
    load1: 14.5,
    swapUsedMb: 6054,
    pressure: 1,
    reclaimableMb: 6400,
    sessions: [],
});
const session = (pid: number, cwd: string) => ({ pid, cwd, ageS: 600 });
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
    fs.rmSync(tmp, { recursive: true, force: true });
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
    delete env.TOLARIA_OVER_CAP;
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

    it("TOLARIA_OVER_CAP=1 starts on the saturated machine, announced and logged", () => {
        const ran = path.join(tmp, "ran");
        const env = gateEnv({ TOLARIA_MACHINE_PROBE: BUSY });
        env.TOLARIA_OVER_CAP = "1";
        const r = runGate("heavy", `touch ${ran}`, env);
        expect(r.status).toBe(0);
        expect(r.stderr).toMatch(
            /machine busy .* starting anyway: TOLARIA_OVER_CAP=1/
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
        if (process.platform === "darwin")
            expect(typeof row!.swap_start_mb).toBe("number");
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

describe("session-admission.sh — the cap applies to every session (issue #4966)", () => {
    const three = [
        session(101, "/repo"),
        session(102, "/repo"),
        session(103, "/repo-issue-7"),
    ];
    const prompt = (sessionId: string, env: Record<string, string>) => {
        const full: NodeJS.ProcessEnv = {
            ...process.env,
            TOLARIA_GATE_LOCK_ROOT: path.join(tmp, "locks"),
            CLAUDE_PROJECT_DIR: tmp,
            ...env,
        };
        if (!("TOLARIA_OVER_CAP" in env)) delete full.TOLARIA_OVER_CAP;
        return spawnSync("sh", [HOOK], {
            input: JSON.stringify({
                session_id: sessionId,
                hook_event_name: "UserPromptSubmit",
                prompt: "hello",
            }),
            env: full,
            encoding: "utf8",
            timeout: 30_000,
        });
    };
    const stamp = (id: string) => path.join(tmp, "locks", "sessions", id);
    const logRows = () =>
        fs
            .readFileSync(
                path.join(
                    tmp,
                    ".claude",
                    "telemetry",
                    "session-admission.jsonl"
                ),
                "utf8"
            )
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>);

    it("blocks a fourth session's first prompt, listing the three live ones", () => {
        const r = prompt("s-4", { TOLARIA_MACHINE_PROBE: probe(three) });
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("3 live project session(s) at the cap of 3");
        expect(r.stderr).toContain("pid 101 · /repo · up 10m");
        expect(r.stderr).toContain("pid 103 · /repo-issue-7 · up 10m");
        expect(r.stderr).toContain("TOLARIA_OVER_CAP=1 claude");
        expect(r.stdout).toBe("");
        // Not stamped: it is asked again on its next prompt.
        expect(fs.existsSync(stamp("s-4"))).toBe(false);
        expect(logRows().at(-1)).toMatchObject({
            event: "refused",
            session: "s-4",
            others: [101, 102, 103],
        });
    });

    it("admits it under the escape hatch, and logs the override", () => {
        const r = prompt("s-4", {
            TOLARIA_MACHINE_PROBE: probe(three),
            TOLARIA_OVER_CAP: "1",
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(
            /machine admission OVERRIDDEN by TOLARIA_OVER_CAP=1/
        );
        expect(fs.existsSync(stamp("s-4"))).toBe(true);
        expect(logRows().at(-1)).toMatchObject({
            event: "override",
            session: "s-4",
            reasons: ["3 live project session(s) at the cap of 3"],
        });
    });

    it("admits a third session silently, and never asks it again", () => {
        const first = prompt("s-3", {
            TOLARIA_MACHINE_PROBE: probe(three.slice(0, 2)),
        });
        expect(first.status).toBe(0);
        expect(first.stdout).toBe("");
        expect(fs.existsSync(stamp("s-3"))).toBe(true);
        // Three OTHERS now, and this session is already in: its later
        // prompts pass on the stamp alone.
        const later = prompt("s-3", { TOLARIA_MACHINE_PROBE: probe(three) });
        expect(later.status).toBe(0);
    });

    it("refuses under memory pressure even with no other session", () => {
        const r = prompt("s-1", {
            TOLARIA_MACHINE_PROBE: probe([], { pressure: 2 }),
        });
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("memory pressure WARNING");
    });

    it("fails open on a payload with no session id", () => {
        const r = spawnSync("sh", [HOOK], {
            input: "{}",
            env: { ...process.env, TOLARIA_MACHINE_PROBE: probe(three) },
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(r.status).toBe(0);
    });
});

describe("health-main — a saturated machine is INFRA, never RED (issue #4966)", () => {
    const git = (args: string[], cwd: string): void => {
        const r = spawnSync("git", args, {
            cwd,
            encoding: "utf8",
            timeout: 20_000,
        });
        if (r.status !== 0)
            throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };

    it("waits, then records infra / machine-saturated at preflight:machine — no RED marker, no gate run", () => {
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

        const env: NodeJS.ProcessEnv = {
            ...process.env,
            TOLARIA_MACHINE_PROBE: BUSY,
            TOLARIA_MACHINE_WAIT_MAX_MS: "300",
            TOLARIA_MACHINE_POLL_MS: "50",
            // No deployment configured: the Convex preflight has nothing to
            // probe, and the machine is asked next.
            VITE_CONVEX_URL: "",
        };
        delete env.TOLARIA_GATE_HELD;
        delete env.TOLARIA_OVER_CAP;
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
});
