// The driver's lanes (issue #5486): `loop-drain.sh --lanes N|auto` keeps up
// to the machine's effective cap of passes alive at once, re-reading the
// admission (`bun scripts/machine.ts lanes`, fed a fake probe through
// `TOLARIA_MACHINE_PROBE`) before every start. The fake probe is static, as
// a real reading is in the seconds after a pass starts: each running lane is
// charged the budget it has yet to take (`laneCharge` — under an injected
// probe no process table is read, so all of it). The
// `claude` stub records a
// `start`/`end` event per pass, so the concurrency the driver actually ran is
// replayed off the event file, never inferred from timing.
import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    CONVEX_ENSURE_UP,
    DRIVER,
    REAL_BUN,
    bin,
    installLoopDrainHarness,
    logLines,
    planBranch,
    run,
    tmp,
    writeStub,
} from "./loop-drain-harness";

installLoopDrainHarness();
// Each pass here really sleeps, several of them back to back.
vi.setConfig({ testTimeout: 60_000 });

/** `sessionBudgetMb` in `tolaria.config.json` — the probe is sized in it. */
const BUDGET_MB = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "..", "..", "tolaria.config.json"),
        "utf8"
    )
).machine.sessionBudgetMb as number;

const ramFor = (sessions: number) => sessions * BUDGET_MB + 100;

const events = () => path.join(tmp, "events");

/** A plan whose batch is `numbers`, in order — the driver asks for one more
 *  item per running lane, and must skip the ones its lanes already hold. */
const stubBunPlan = (numbers: number[]): void => {
    const plan = JSON.stringify({
        version: 1,
        lane: "engine",
        batch: numbers.map((number) => ({
            number,
            title: `issue ${number}`,
            type: "feat",
            model: "sonnet",
            hitl: false,
            targetFiles: [],
            blastRadius: "declared",
            lane: "engine",
            reason: "admitted",
        })),
        deferred: [],
        skipped: [],
        staleClaims: [],
    });
    writeStub(
        "bun",
        [
            `case "$*" in`,
            `  *loop-doctor.ts*) exit 0 ;;`,
            `esac`,
            CONVEX_ENSURE_UP,
            `if [ "$1" = "run" ] && [ "$2" = "queue:plan" ]; then`,
            `  cat <<'PLANEOF'`,
            plan,
            `PLANEOF`,
            `  exit 0`,
            `fi`,
            // `bun -e`, the health reader and `machine.ts lanes` run for real.
            planBranch(),
            `if [ -x "${REAL_BUN}" ]; then exec "${REAL_BUN}" "$@"; fi`,
            `exit 1`,
        ].join("\n")
    );
};

/** `gh`: a steady queue of 9; `pr list --head feat/issue-N` answers the PR a
 *  pass handed off (the `handed-N` file the `claude` stub writes); `issue
 *  view` answers `<state> <claimed> true` (`state` file, default OPEN;
 *  `claimed` file, default false). */
const stubGh = (): void => {
    writeStub(
        "gh",
        [
            `case "$*" in`,
            `  *"pr list"*)`,
            `    n=$(printf '%s' "$*" | sed -n 's/.*--head [a-z]*\\/issue-\\([0-9][0-9]*\\).*/\\1/p')`,
            `    cat "${tmp}/handed-$n" 2>/dev/null`,
            `    exit 0 ;;`,
            `  *"issue view"*) echo "$(cat "${tmp}/state" 2>/dev/null || echo OPEN) $(cat "${tmp}/claimed" 2>/dev/null || echo false) true"; exit 0 ;;`,
            `  *) echo 9 ;;`,
            `esac`,
        ].join("\n")
    );
};

/** `claude`: records `start N` / `end N` around a sleep, then (by default)
 *  hands the issue off as a PR — a NEW number on every pass, since the plan
 *  stub offers the same issues again. `body` runs between the two events, with
 *  `$issue` set — a per-issue behaviour goes there. */
const stubClaude = (body = "sleep 2", handOff = true): void => {
    writeStub(
        "claude",
        [
            `issue=$(printf '%s' "$*" | sed -n 's/.*\\/next-ticket \\([0-9][0-9]*\\).*/\\1/p')`,
            `echo "start $issue" >> "${events()}"`,
            `echo "pass body of $issue"`,
            body,
            handOff
                ? `echo $((5000 + issue * 10 + $(grep -c "start $issue" "${events()}"))) > "${tmp}/handed-$issue"`
                : ``,
            `echo "end $issue" >> "${events()}"`,
            `exit 0`,
        ].join("\n")
    );
};

/** Replays the event file: the most passes alive at once, and every pair of
 *  passes that ran the same issue at the same time. */
const replay = () => {
    const lines = fs.existsSync(events())
        ? fs.readFileSync(events(), "utf8").trim().split("\n")
        : [];
    const live = new Map<string, number>();
    let peak = 0;
    let alive = 0;
    const clashes: string[] = [];
    for (const line of lines) {
        const [ev, issue] = line.split(" ");
        if (ev === "start") {
            if ((live.get(issue) ?? 0) > 0) clashes.push(issue);
            live.set(issue, (live.get(issue) ?? 0) + 1);
            peak = Math.max(peak, ++alive);
        } else {
            live.set(issue, (live.get(issue) ?? 1) - 1);
            alive--;
        }
    }
    return {
        peak,
        clashes,
        starts: lines.filter((l) => l.startsWith("start")).length,
    };
};

const runLanes = (
    args: string[],
    probe: Record<string, number> = { load1: 1, pressure: 1 }
) =>
    run({
        args: ["--claude-args", "x", ...args],
        env: {
            TOLARIA_MACHINE_PROBE: JSON.stringify(probe),
            TOLARIA_LOOP_LANE_TICK_SECS: "0.2",
        },
    });

const reasons = () => logLines().map((l) => l.split(" ").pop());

describe("loop-drain lanes — how many at once (issue #5486)", () => {
    it("RAM for 2 → two passes run at once, never three; max-passes is shared", () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        stubClaude();
        const r = runLanes(["--lanes", "auto", "--max-passes", "4"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(2),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        const seen = replay();
        expect(seen.peak).toBe(2);
        expect(seen.starts).toBe(4);
        expect(seen.clashes).toEqual([]);
        expect(r.stdout).toMatch(/reason=max-passes .* lanes=2 /);
        expect(r.stderr).toMatch(/loop-drain: lanes 2 \(reclaimable/);
        // Every pass is accounted for, and named by its lane.
        expect(reasons()).toEqual(["-", "-", "-", "-"]);
        const logs = fs.readdirSync(
            path.join(tmp, ".claude", "telemetry", "loop-drain")
        );
        expect(logs).toHaveLength(4);
        for (const f of logs)
            expect(f).toMatch(/^pass-\d+-lane-[12]-\d+\.log$/);
        expect(r.stderr).toMatch(
            /loop-drain\[pass\]: pass 2 — lane 2 — issue #102 on tier sonnet\./
        );
        expect(r.stderr).toMatch(/loop-drain\[end\]: pass=\d lane=[12] /);
        // Two lanes' untagged output would interleave on the terminal: it
        // stays in each pass's own log.
        expect(r.stdout).not.toMatch(/pass body of/);
        const logDir = path.join(tmp, ".claude", "telemetry", "loop-drain");
        expect(
            fs.readFileSync(
                path.join(
                    logDir,
                    logs.find((f) => f.startsWith("pass-2-lane-2-"))!
                ),
                "utf8"
            )
        ).toMatch(/pass body of 102/);
        // Nothing is left in flight.
        expect(
            fs.readdirSync(path.join(tmp, ".claude", "telemetry", "loop-lanes"))
        ).toEqual([]);
    });

    it("--lanes caps it lower than the RAM would allow", () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        stubClaude();
        const r = runLanes(["--lanes", "2", "--max-passes", "4"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(replay().peak).toBe(2);
    });

    it.each([
        ["load over loadMax", { load1: 99, pressure: 1 }],
        ["memory pressure", { load1: 1, pressure: 2 }],
    ])("RAM for 5 but %s → one lane", (_why, busy) => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        // Long enough that a second lane, were it allowed, starts beside it
        // (a pressure reading is re-sampled before it counts, ~1 s a probe).
        stubClaude("sleep 3");
        const r = runLanes(["--lanes", "auto", "--max-passes", "3"], {
            ...busy,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        const seen = replay();
        expect(seen.starts).toBe(3);
        expect(seen.peak).toBe(1);
    });

    it("never hands one issue to two lanes — a plan offering only the running one holds the second lane", () => {
        // The plan has one item and the stub never claims it: only the
        // driver's own busy set keeps the second lane off it. A collision
        // past that set meets `queue:claim`'s lock (queue-claim.test.ts:
        // "refuses a collision outright", "the lock serialises two real
        // processes").
        stubGh();
        stubBunPlan([101]);
        stubClaude("sleep 2");
        const r = runLanes(["--lanes", "auto", "--max-passes", "2"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        const seen = replay();
        expect(seen.starts).toBe(2);
        expect(seen.clashes).toEqual([]);
        expect(seen.peak).toBe(1);
        expect(r.stderr).toMatch(
            /no new pass for now \(preflight-error\) — 1 running/
        );
    });
});

describe("loop-drain lanes — one account, one run (issue #5486)", () => {
    it("a rate limit in one lane pauses all: no lane starts another pass, the running one finishes and is accounted", () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        stubClaude(
            [
                `if [ "$issue" = "101" ]; then`,
                `  sleep 2`,
                `  echo "Claude AI usage limit reached. Try again later."`,
                `else`,
                `  sleep 4`,
                `fi`,
            ].join("\n")
        );
        const r = runLanes(["--lanes", "2", "--max-passes", "10"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(r.stdout).toMatch(/reason=rate-limit/);
        const seen = replay();
        expect(seen.starts).toBe(2);
        expect(fs.readFileSync(events(), "utf8")).toMatch(/end 102/);
        expect(reasons().sort()).toEqual(["-", "rate-limit"]);
        expect(r.stderr).toMatch(
            /rate-limit on pass 1 — no lane starts another pass; the 1 running finish first/
        );
    });

    it("a pass that ran beside another is judged on its OWN issue: still claimed with no hand-off = died holding claims", () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        stubClaude("sleep 2", false);
        fs.writeFileSync(path.join(tmp, "claimed"), "true\n");
        const r = runLanes(["--lanes", "auto", "--max-passes", "2"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(replay().peak).toBe(2);
        expect(reasons()).toEqual(["claims-held-retry", "claims-held-retry"]);
    });

    it("…closed with no hand-off (a docs PR, closed by hand) = progress", () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        stubClaude("sleep 2", false);
        fs.writeFileSync(path.join(tmp, "state"), "CLOSED\n");
        fs.writeFileSync(path.join(tmp, "claimed"), "true\n");
        const r = runLanes(["--lanes", "auto", "--max-passes", "2"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
        expect(reasons()).toEqual(["-", "-"]);
    });

    it("…and released with no hand-off = its issue excluded for the run; nothing else left stops it on no-progress (issue #5564)", () => {
        stubGh();
        stubBunPlan([101, 102]);
        stubClaude("sleep 2", false);
        const r = runLanes(["--lanes", "auto", "--max-passes", "5"], {
            load1: 1,
            pressure: 1,
            reclaimableMb: ramFor(5),
        });
        expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
        expect(replay().starts).toBe(2);
        expect(reasons()).toEqual(["-", "-"]);
        expect(r.stdout).toMatch(/reason=no-progress/);
        expect(r.stderr).toMatch(/excluded this run .*: #10[12] #10[12]$/m);
    });

    it("SIGTERM to the driver ends every pass in flight — a background pass ignores the terminal's SIGINT, so the driver forwards it", async () => {
        stubGh();
        stubBunPlan([101, 102, 103, 104, 105]);
        writeStub(
            "claude",
            [
                `issue=$(printf '%s' "$*" | sed -n 's/.*\\/next-ticket \\([0-9][0-9]*\\).*/\\1/p')`,
                `echo "$$" >> "${tmp}/claude-pids"`,
                `echo "start $issue" >> "${events()}"`,
                `exec sleep 30`,
            ].join("\n")
        );
        const child = spawn(
            "sh",
            [DRIVER, "--claude-args", "x", "--lanes", "auto"],
            {
                cwd: tmp,
                stdio: "ignore",
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env.PATH}`,
                    TOLARIA_LOOP_TOKEN_BUDGET: "",
                    TOLARIA_LOOP_ALLOW_NO_BUDGET: "1",
                    TOLARIA_MACHINE_PROBE: JSON.stringify({
                        load1: 1,
                        pressure: 1,
                        reclaimableMb: ramFor(2),
                    }),
                    TOLARIA_LOOP_LANE_TICK_SECS: "0.2",
                },
            }
        );
        const exited = new Promise<number | null>((resolve) =>
            child.on("exit", (code) => resolve(code))
        );
        const pids = () =>
            fs.existsSync(path.join(tmp, "claude-pids"))
                ? fs
                      .readFileSync(path.join(tmp, "claude-pids"), "utf8")
                      .trim()
                      .split("\n")
                      .map(Number)
                : [];
        const deadline = Date.now() + 30_000;
        while (pids().length < 2 && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 100));
        expect(pids()).toHaveLength(2);
        child.kill("SIGTERM");
        expect(await exited).toBe(130);
        const alive = (pid: number) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch {
                return false;
            }
        };
        const gone = Date.now() + 5_000;
        while (pids().some(alive) && Date.now() < gone)
            await new Promise((r) => setTimeout(r, 100));
        const survivors = pids().filter(alive);
        for (const pid of survivors) process.kill(pid, "SIGKILL");
        expect(survivors).toEqual([]);
        expect(
            fs.readdirSync(path.join(tmp, ".claude", "telemetry", "loop-lanes"))
        ).toEqual([]);
    });
});
