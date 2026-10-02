/**
 * Machine admission (issue #4966) — the one place that looks at the MACHINE.
 *
 * WHY. The gates ration CPU among themselves: the heavy mutex (`gate.ts`), the
 * `check:ui` lane (`ui-admission.ts`), the session cap on claims
 * (`queue-claim.ts`). None of them looked at the machine they run on. A gate
 * that took the mutex on a machine already at load 14 ran anyway, a browser
 * walk started beside it, and the verdicts they wrote were the machine's: the
 * full walk of tip aa785cf0 started at load 14.5 and ended, 45 minutes later
 * instead of 12, with 37 cells `INFRA` and 48 `UNWALKED`; `gate.ts`'s own
 * header records the bot suite blowing its 60 s per-test ceiling under load.
 * The only load reading in the system
 * was taken AFTER a cell had failed. And `sessions.cap` counted CLAIMS, so a
 * session opened by hand, an interactive audit or a fourth terminal was
 * counted by nothing.
 *
 * MODEL. Two decisions over one set of probes, both pure:
 *
 *   gate start — `gateAdmission`. A heavy gate, the `check:ui` lane and
 *       `health-main` ask before they start. On a saturated machine (1-min
 *       load over `machine.loadMax`, or the kernel reporting memory pressure)
 *       they WAIT, bounded by `machine.waitMaxS`; past the bound the run is
 *       `refuse`d — recorded `infra` / `machine-saturated`, never RED, never
 *       a red lane (`MACHINE_SATURATED_EXIT`).
 *   session — `sessionAdmission`. A session's first prompt, `queue:claim` and
 *       `wt:new` ask whether the machine has room for one more: the OTHER
 *       live project sessions against the effective cap, and the same memory
 *       pressure reading (sustained, and only beside other sessions — the
 *       only session is never refused). A session does not wait — it is
 *       refused, naming the live sessions and the one escape
 *       (`TOLARIA_OVER_CAP=1`).
 *
 * MEMORY IS THE KERNEL'S VERDICT, NOT A SWAP LEVEL. Swap in use is recorded
 * beside every run and printed on every busy line, and it is not a threshold:
 * measured 2026-10-02 on this machine, it read 4498 MB at load 22 and 6054 MB
 * twenty minutes later at load 2.5 with 6.4 GB reclaimable. It is a high-water
 * mark — what the machine once needed, not what it needs — and a threshold on
 * it refuses a calm machine for as long as the mark stands. The state is
 * `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning (the compressor
 * and swap are working NOW), 4 critical. Anything past normal saturates.
 *
 * The two differ on LOAD, deliberately. The 1-minute load average is what an
 * admitted gate itself raises: four vitest workers and `tsc -b` hold it above
 * `machine.loadMax` for the whole run. Read at a session's first prompt it
 * would refuse every session opened during a `land`, for a start that adds no
 * load at all. So load gates what is about to ADD load; memory — sustained,
 * and what a session does consume — gates the session.
 *
 * Every threshold is `tolaria.config.json` § `machine`, derived in
 * `docs/agents/quality-gates.md` § Session admission, "The machine". Nothing
 * here is a literal.
 *
 * A probe that cannot be read (another platform, a failed spawn) reads `null`
 * and `null` never saturates: like `readLastSleepAt`, the reading may only
 * ever hold back a run the machine provably cannot carry, never invent one.
 *
 * Node builtins plus `lib/branches.ts` (itself builtins only): `health-main.ts`
 * imports this before `node_modules` may exist.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { CONFIG_PATH, sessionCap } from "./branches";

/** What a gate exits with when the machine stayed saturated past the bound:
 *  nothing ran, so this is no verdict on the tree. `health-verdict.ts` reads
 *  it as `infra` / `machine-saturated`; `gate-run.sh` owns 75 and 76. */
export const MACHINE_SATURATED_EXIT = 77;

/** The announced escape for a SESSION — `TOLARIA_OVER_CAP=1 claude`, the
 *  machine equivalent of `--no-cap`. Every use is logged. It is read by the
 *  session decision alone: a session started past the cap passes the variable
 *  to every gate it runs, and those must still wait for the machine. */
export const OVER_CAP_ENV = "TOLARIA_OVER_CAP";

/** The announced escape for a GATE: start on a saturated machine anyway.
 *  Deliberately a different variable from the session's (see above). */
export const GATE_OVERRIDE_ENV = "TOLARIA_GATE_SATURATED_OK";

/** Tests only: a JSON `InjectedProbe` read INSTEAD of the machine, so a suite
 *  run on a saturated machine neither waits on it nor passes because of it. */
export const PROBE_ENV = "TOLARIA_MACHINE_PROBE";

// ── configuration ───────────────────────────────────────────────────────────

export interface MachineThresholds {
    /** Highest 1-minute load average at which something heavy may start. */
    loadMax: number;
    /** RAM one session at work needs (MB): the process tree plus its targeted
     *  vitest. The dynamic cap divides reclaimable RAM by it. */
    sessionBudgetMb: number;
    /** How long a gate waits for the machine before it gives the run up. */
    waitMaxS: number;
}

const KEYS = ["loadMax", "sessionBudgetMb", "waitMaxS"] as const;

/** Parse and validate the `machine` block. Exported for the tests. */
export function parseMachineConfig(
    raw: string,
    source = CONFIG_PATH
): MachineThresholds {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
    }
    const machine = (doc as { machine?: unknown })?.machine;
    if (!machine || typeof machine !== "object") {
        throw new Error(`${source}: missing "machine" object`);
    }
    const out = {} as MachineThresholds;
    for (const key of KEYS) {
        const v = (machine as Record<string, unknown>)[key];
        // A zero or negative threshold refuses everything, with a message
        // that reads like a busy machine — loud here instead.
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
            throw new Error(
                `${source}: machine.${key} must be a positive number, got ${JSON.stringify(v)}`
            );
        }
        out[key] = v;
    }
    return out;
}

export function readMachineConfig(path = CONFIG_PATH): MachineThresholds {
    return parseMachineConfig(readFileSync(path, "utf8"), path);
}

// ── the sample ──────────────────────────────────────────────────────────────

export interface MachineSample {
    /** 1-minute load average. */
    load1: number;
    /** Swap in use, MB — null where the platform does not say. Recorded,
     *  never a threshold (see the header). */
    swapUsedMb: number | null;
    /** The kernel's memory pressure level — 1 normal, 2 warning, 4 critical;
     *  null where the platform does not say. */
    pressure: number | null;
    /** Free + inactive RAM, MB — null where the platform does not say. */
    reclaimableMb: number | null;
}

/** One live `claude` process whose cwd is the primary checkout or a worktree
 *  of it. */
export interface LiveSession {
    pid: number;
    cwd: string;
    /** Seconds since the process started; null when `ps` did not say. */
    ageS: number | null;
}

interface InjectedProbe extends Partial<MachineSample> {
    sessions?: LiveSession[];
}

/** `total = 6144.00M  used = 4497.69M  free = 1646.31M  (encrypted)` → MB. */
export function parseSwapUsage(out: string): number | null {
    const m = /used\s*=\s*([\d.]+)([KMG])/.exec(out);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return m[2] === "G" ? n * 1024 : m[2] === "K" ? n / 1024 : n;
}

/** `kern.memorystatus_vm_pressure_level` → 1 | 2 | 4, or null. */
export function parsePressure(out: string): number | null {
    const n = Number(out.trim());
    return out.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/** `vm_stat` → free + inactive pages, in MB. */
export function parseVmStat(out: string): number | null {
    const page = /page size of (\d+) bytes/.exec(out);
    const free = /^Pages free:\s+(\d+)\./m.exec(out);
    const inactive = /^Pages inactive:\s+(\d+)\./m.exec(out);
    if (!page || !free || !inactive) return null;
    return (
        ((Number(free[1]) + Number(inactive[1])) * Number(page[1])) / 1024 ** 2
    );
}

/** `ps`'s `etime` — `[[dd-]hh:]mm:ss` — in seconds. */
export function parseEtime(etime: string): number | null {
    const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
    if (!m) return null;
    return (
        Number(m[1] ?? 0) * 86_400 +
        Number(m[2] ?? 0) * 3600 +
        Number(m[3]) * 60 +
        Number(m[4])
    );
}

export interface ProcRow {
    pid: number;
    ppid: number;
    ageS: number | null;
    /** Resident memory, KB. */
    rssKb: number;
    /** Basename of the command's first word. */
    comm: string;
}

const PS_FORMAT = "pid=,ppid=,etime=,rss=,comm=";

/** `ps -axo pid=,ppid=,etime=,rss=,comm=` → rows. `comm` is last because it
 *  may carry spaces (`claude bg-pty-host`); its first word's basename is the
 *  name. */
export function parseProcRows(out: string): ProcRow[] {
    const rows: ProcRow[] = [];
    for (const line of out.split("\n")) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)/.exec(line);
        if (!m) continue;
        rows.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            ageS: parseEtime(m[3]),
            rssKb: Number(m[4]),
            comm: m[5].split("/").pop() ?? m[5],
        });
    }
    return rows;
}

/** Resident memory of a process and everything under it, MB — what one
 *  session costs while it works (`machine.sessionBudgetMb` is measured with
 *  this). */
export function subtreeRssMb(
    rows: readonly ProcRow[],
    root: number,
    /** Subtrees that are counted elsewhere — a session a session spawned. */
    exclude: ReadonlySet<number> = new Set()
): number {
    const children = new Map<number, ProcRow[]>();
    for (const r of rows)
        children.set(r.ppid, [...(children.get(r.ppid) ?? []), r]);
    let kb = 0;
    const seen = new Set<number>();
    const stack = rows.filter((r) => r.pid === root);
    while (stack.length > 0) {
        const r = stack.pop()!;
        if (seen.has(r.pid) || (exclude.has(r.pid) && r.pid !== root)) continue;
        seen.add(r.pid);
        kb += r.rssKb;
        stack.push(...(children.get(r.pid) ?? []));
    }
    return kb / 1024;
}

/** `lsof -a -d cwd -p <pids> -Fpn` → pid → cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
    const cwds = new Map<number, string>();
    let pid: number | null = null;
    for (const line of out.split("\n")) {
        if (line.startsWith("p")) pid = Number(line.slice(1));
        else if (line.startsWith("n") && pid !== null)
            cwds.set(pid, line.slice(1));
    }
    return cwds;
}

/** `git worktree list --porcelain` → every checkout of this repository, the
 *  primary first. */
export function parseWorktreeRoots(out: string): string[] {
    return out
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice("worktree ".length));
}

const SESSION_COMM = "claude";

/** The session a process runs in: its nearest `claude` ancestor (itself
 *  included), or null outside any session. */
export function owningSession(rows: ProcRow[], pid: number): number | null {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    let at = byPid.get(pid);
    for (let depth = 0; at && depth < 32; depth++) {
        if (at.comm === SESSION_COMM) return at.pid;
        at = byPid.get(at.ppid);
    }
    return null;
}

const under = (path: string, root: string): boolean =>
    path === root || path.startsWith(`${root}/`);

/**
 * The live project sessions: every `claude` process whose cwd is one of this
 * repository's checkouts. The cwd is what separates a session from the
 * processes that share its name — the background daemon sits in `$HOME`, a
 * pty host and an unclaimed spare in the daemon's own scratch directory —
 * and a session on another project from one on this.
 */
export function liveProjectSessions(
    rows: ProcRow[],
    cwds: Map<number, string>,
    roots: readonly string[]
): LiveSession[] {
    return rows
        .filter((r) => r.comm === SESSION_COMM)
        .flatMap((r) => {
            const cwd = cwds.get(r.pid);
            return cwd !== undefined && roots.some((root) => under(cwd, root))
                ? [{ pid: r.pid, cwd, ageS: r.ageS }]
                : [];
        })
        .sort((a, b) => a.pid - b.pid);
}

// ── the decisions — pure ────────────────────────────────────────────────────

const fmt = (n: number): string => n.toFixed(1);
const mb = (n: number): string => `${Math.round(n)} MB`;

/** The kernel's level past which memory is saturated: anything over normal. */
export const PRESSURE_NORMAL = 1;

/** Why memory is saturated — the kernel says so — or nothing. */
export function memorySaturation(sample: MachineSample): string[] {
    return sample.pressure !== null && sample.pressure > PRESSURE_NORMAL
        ? [
              `memory pressure ${sample.pressure >= 4 ? "CRITICAL" : "WARNING"} (kernel level ${sample.pressure})`,
          ]
        : [];
}

/** Why nothing heavy may start, one reason per threshold crossed; empty on a
 *  calm machine. */
export function saturation(
    sample: MachineSample,
    t: MachineThresholds
): string[] {
    return [
        ...(sample.load1 > t.loadMax
            ? [`load ${fmt(sample.load1)} > ${fmt(t.loadMax)}`]
            : []),
        ...memorySaturation(sample),
    ];
}

/** `load L, swap S` — what every busy line and every record prints. */
export function sampleLine(sample: MachineSample): string {
    return `load ${fmt(sample.load1)}, swap ${
        sample.swapUsedMb === null ? "unread" : mb(sample.swapUsedMb)
    }`;
}

export type GateAdmission =
    | { verdict: "admit" }
    | { verdict: "wait"; reasons: string[] }
    | { verdict: "refuse"; reasons: string[] };

/** May something heavy start now? `refuse` only once the wait has run its
 *  whole bound: a saturated machine is waited out, never raced. */
export function gateAdmission(input: {
    sample: MachineSample;
    thresholds: MachineThresholds;
    waitedMs: number;
}): GateAdmission {
    const reasons = saturation(input.sample, input.thresholds);
    if (reasons.length === 0) return { verdict: "admit" };
    return input.waitedMs >= input.thresholds.waitMaxS * 1000
        ? { verdict: "refuse", reasons }
        : { verdict: "wait", reasons };
}

/**
 * How many sessions the machine carries. `sessions.cap` is the ceiling; under
 * it, the RAM decides: what is reclaimable NOW — with the `others` already
 * running — holds `floor(reclaimable / budget)` more. Never below one: a
 * machine too full for a single session is not something an admission hook
 * may decide, and refusing the only session is refusing the one that would
 * fix it. An unread probe leaves the ceiling.
 */
export function effectiveCap(input: {
    cap: number;
    others: number;
    reclaimableMb: number | null;
    sessionBudgetMb: number;
}): number {
    if (input.reclaimableMb === null) return input.cap;
    const room = Math.floor(input.reclaimableMb / input.sessionBudgetMb);
    return Math.max(1, Math.min(input.cap, input.others + room));
}

export type SessionAdmission =
    | { verdict: "admit"; effectiveCap: number; overridden: string[] }
    | { verdict: "refuse"; effectiveCap: number; reasons: string[] };

/**
 * May one more session work on this machine? `others` is every live project
 * session but the one asking. `override` (`TOLARIA_OVER_CAP=1`, `--no-cap`)
 * admits whatever the reasons — and carries them, so the caller announces and
 * logs what it overrode.
 */
export function sessionAdmission(input: {
    others: readonly LiveSession[];
    cap: number;
    sample: MachineSample;
    thresholds: MachineThresholds;
    override: boolean;
}): SessionAdmission {
    const { others, cap, sample, thresholds } = input;
    const eff = effectiveCap({
        cap,
        others: others.length,
        reclaimableMb: sample.reclaimableMb,
        sessionBudgetMb: thresholds.sessionBudgetMb,
    });
    const reasons: string[] = [];
    if (others.length >= eff)
        reasons.push(
            eff < cap
                ? `${others.length} live project session(s) and no RAM for another — effective cap ${eff} of ${cap} (reclaimable ${mb(sample.reclaimableMb ?? 0)}, ${mb(thresholds.sessionBudgetMb)} per session)`
                : `${others.length} live project session(s) at the cap of ${cap}`
        );
    // Memory pressure refuses a session only BESIDE others: alone, it is the
    // session that would relieve the pressure, and refusing it is the
    // lock-out `effectiveCap`'s floor of one already rules out.
    if (others.length > 0) reasons.push(...memorySaturation(sample));
    if (reasons.length === 0 || input.override)
        return { verdict: "admit", effectiveCap: eff, overridden: reasons };
    return { verdict: "refuse", effectiveCap: eff, reasons };
}

function fmtAge(ageS: number | null): string {
    if (ageS === null) return "age unknown";
    if (ageS < 60) return `${ageS}s`;
    if (ageS < 3600) return `${Math.floor(ageS / 60)}m`;
    return `${Math.floor(ageS / 3600)}h${String(Math.floor((ageS % 3600) / 60)).padStart(2, "0")}m`;
}

export function sessionLine(s: LiveSession): string {
    return `pid ${s.pid} · ${s.cwd} · up ${fmtAge(s.ageS)}`;
}

/** The refusal a session reads: why, who is using the machine, the way out. */
export function sessionRefusal(
    reasons: readonly string[],
    others: readonly LiveSession[]
): string {
    return [
        `machine admission refused this session — ${reasons.join("; ")}.`,
        ...(others.length > 0 ? ["Live project sessions:"] : []),
        ...others.map((s) => `  ${sessionLine(s)}`),
        `Close one, or see \`bun run machine\`. The one escape, announced and logged: ${OVER_CAP_ENV}=1 claude`,
    ].join("\n");
}

/**
 * Whether a run's own samples say the machine was saturated while it ran —
 * what turns a timeout or an unsettled walk into `infra` (`health-verdict.ts`)
 * instead of a verdict on the tree.
 */
export function runSaturated(
    samples: readonly (MachineSample | null)[],
    t: MachineThresholds
): boolean {
    return samples.some((s) => s !== null && saturation(s, t).length > 0);
}

/**
 * Whether EVERY test a vitest run failed, it failed by timing out — the only
 * failure a saturated machine explains. One assertion that failed beside the
 * timeouts and the run is the tree's.
 */
export function timeoutOnlyFailure(output: string): boolean {
    const failed = [...output.matchAll(/^\s*Tests\s+(\d+) failed/gm)].reduce(
        (n, m) => n + Number(m[1]),
        0
    );
    // Vitest's "Failed Tests" section: one ` FAIL  <file> > <test>` line per
    // failed test, its error on the next line. Read per block, never as two
    // counts over the whole output — a timeout message printed twice must
    // not stand in for an assertion printed once.
    const lines = output.split("\n");
    let blocks = 0;
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*FAIL\s+\S/.test(lines[i])) continue;
        blocks++;
        const error = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
        if (!/^\s*Error: (?:Test|Hook) timed out in \d+ms/.test(error))
            return false;
    }
    // Every failed test accounted for: a failure with no block of its own is
    // one this cannot vouch for.
    return failed > 0 && blocks === failed;
}

// ── the probes — thin ───────────────────────────────────────────────────────

function injected(env: NodeJS.ProcessEnv): InjectedProbe | null {
    const raw = env[PROBE_ENV];
    if (!raw) return null;
    return JSON.parse(raw) as InjectedProbe;
}

/** Whether this process reads an injected probe instead of the machine. */
export function probeInjected(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env[PROBE_ENV]);
}

/** Spawned from `/` unless the command reads its cwd: a probe must still
 *  answer when the caller's own cwd has been deleted under it — `land`
 *  removes the worktree its gate runs in (issue #4984). */
function run(cmd: string, args: string[], cwd = "/"): string | null {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000, cwd });
    return r.status === 0 ? r.stdout : null;
}

export function readMachineSample(
    env: NodeJS.ProcessEnv = process.env
): MachineSample {
    const fake = injected(env);
    if (fake)
        return {
            load1: fake.load1 ?? 0,
            swapUsedMb: fake.swapUsedMb ?? null,
            pressure: fake.pressure ?? null,
            reclaimableMb: fake.reclaimableMb ?? null,
        };
    const darwin = process.platform === "darwin";
    // One `sysctl` for both readings: a line each, in the order asked.
    const sys = darwin
        ? run("sysctl", [
              "-n",
              "vm.swapusage",
              "kern.memorystatus_vm_pressure_level",
          ])
        : null;
    const vm = darwin ? run("vm_stat", []) : null;
    const [swapLine, pressureLine] = (sys ?? "").split("\n");
    return {
        load1: loadavg()[0],
        swapUsedMb: sys === null ? null : parseSwapUsage(swapLine ?? ""),
        pressure: sys === null ? null : parsePressure(pressureLine ?? ""),
        reclaimableMb: vm === null ? null : parseVmStat(vm),
    };
}

export interface SessionCensus {
    /** Every live project session, this one included. */
    all: LiveSession[];
    /** The session asking, when the caller runs inside one. */
    self: number | null;
    /** `all` without `self` — what the cap counts. */
    others: LiveSession[];
    /** The process table the census was read from; empty under an injected
     *  probe. */
    rows: ProcRow[];
}

/**
 * Who is using the machine. Null when a probe could not be read — the caller
 * admits (see the header): a broken `ps` must not lock every session out.
 */
export function readSessionCensus(
    cwd: string = process.cwd(),
    env: NodeJS.ProcessEnv = process.env,
    pid: number = process.pid
): SessionCensus | null {
    const fake = injected(env);
    if (fake) {
        const all = fake.sessions ?? [];
        return { all, self: null, others: all, rows: [] };
    }
    const ps = run("ps", ["-axo", PS_FORMAT]);
    const worktrees = run("git", ["worktree", "list", "--porcelain"], cwd);
    if (ps === null || worktrees === null) return null;
    const rows = parseProcRows(ps);
    const candidates = rows.filter((r) => r.comm === SESSION_COMM);
    const self = owningSession(rows, pid);
    if (candidates.length === 0) return { all: [], self, others: [], rows };
    const lsof = spawnSync(
        "lsof",
        [
            "-a",
            "-d",
            "cwd",
            "-p",
            candidates.map((r) => r.pid).join(","),
            "-Fpn",
        ],
        { encoding: "utf8", timeout: 5000, cwd: "/" }
    );
    // `lsof` exits 1 when ANY listed pid vanished between the two reads and
    // still prints the rest; only an empty answer is an unread probe.
    if (!lsof.stdout) return null;
    const all = liveProjectSessions(
        rows,
        parseLsofCwd(lsof.stdout),
        parseWorktreeRoots(worktrees)
    );
    return { all, self, others: all.filter((s) => s.pid !== self), rows };
}

export interface SessionAdmissionNow {
    decision: SessionAdmission;
    /** Null when the process table could not be read: admitted, uncounted. */
    census: SessionCensus | null;
    sample: MachineSample;
    thresholds: MachineThresholds;
    cap: number;
}

/**
 * A sample whose memory pressure is SUSTAINED. The kernel's level flickers —
 * measured 2026-10-02: one reading at 2, then six at 1 over the next thirty
 * seconds — and a session is refused on one decision, not waited out like a
 * gate. So a reading past normal is taken again, up to `retries` times
 * `gapMs` apart, and the calmest of them stands.
 */
export function sustainedSample(
    read: () => MachineSample,
    pause: (ms: number) => void = (ms) =>
        void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    retries = 2,
    gapMs = 500
): MachineSample {
    let sample = read();
    for (let i = 0; i < retries && memorySaturation(sample).length > 0; i++) {
        pause(gapMs);
        sample = read();
    }
    return sample;
}

/**
 * The session decision on the live machine — the ONE composition the hook,
 * `queue:claim` and `wt:new` share, so the three cannot disagree about who is
 * counted or what the cap is.
 */
export function admitSessionNow(input: {
    override: boolean;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}): SessionAdmissionNow {
    const env = input.env ?? process.env;
    const thresholds = readMachineConfig();
    const cap = sessionCap();
    const sample = sustainedSample(() => readMachineSample(env));
    const census = readSessionCensus(input.cwd, env);
    const decision = sessionAdmission({
        others: census?.others ?? [],
        cap,
        sample,
        thresholds,
        override: input.override,
    });
    return { decision, census, sample, thresholds, cap };
}

/** One row per session decision in `.claude/telemetry/session-admission.jsonl`
 *  — the record an override leaves (`event: "override"`). Never load-bearing. */
export function logSessionAdmission(
    root: string,
    now: SessionAdmissionNow,
    who: { source: string; session?: string }
): void {
    const { decision, census, sample } = now;
    const event =
        decision.verdict === "refuse"
            ? "refused"
            : decision.overridden.length > 0
              ? "override"
              : "admitted";
    try {
        const dir = join(root, ".claude", "telemetry");
        mkdirSync(dir, { recursive: true });
        appendFileSync(
            join(dir, "session-admission.jsonl"),
            JSON.stringify({
                ts: Math.floor(Date.now() / 1000),
                event,
                ...who,
                reasons:
                    decision.verdict === "refuse"
                        ? decision.reasons
                        : decision.overridden,
                effective_cap: decision.effectiveCap,
                others: (census?.others ?? []).map((s) => s.pid),
                load: sample.load1,
                swap_mb: sample.swapUsedMb,
                pressure: sample.pressure,
                reclaimable_mb: sample.reclaimableMb,
            }) + "\n"
        );
    } catch {
        /* telemetry is never load-bearing */
    }
}

// ── the wait ────────────────────────────────────────────────────────────────

export interface WaitForMachineInput {
    thresholds: MachineThresholds;
    /** Prefix of every line: `[gate]`, `[check:ui]`, `health-main:`. */
    tag: string;
    announce: (line: string) => void;
    probe?: () => MachineSample;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
    env?: NodeJS.ProcessEnv;
    /** Called on every poll, the admitting one included — a holder restamps
     *  its lock here, so a long wait never reads as a silent holder. */
    tick?: () => void;
}

export interface WaitForMachineResult {
    admitted: boolean;
    /** The escape hatch was used on a saturated machine. */
    overridden: boolean;
    waitedMs: number;
    /** The sample the verdict was reached on. */
    sample: MachineSample;
    reasons: string[];
}

const WAIT_POLL_MS = 5000;

/**
 * Hold a run until the machine can carry it, or until the bound. The line it
 * prints names what it is waiting on — `machine busy — load L, swap S` — on
 * the first poll and once a minute after, so a queued session reads a reason
 * and not a hang.
 *
 * `TOLARIA_MACHINE_WAIT_MAX_MS` / `TOLARIA_MACHINE_POLL_MS` are the suite's
 * seams, the same convention as `gate.ts`'s `TOLARIA_GATE_*`.
 */
export async function waitForMachine(
    input: WaitForMachineInput
): Promise<WaitForMachineResult> {
    const env = input.env ?? process.env;
    const probe = input.probe ?? (() => readMachineSample(env));
    const now = input.now ?? Date.now;
    const sleep =
        input.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    const pollMs =
        input.pollMs ?? Number(env.TOLARIA_MACHINE_POLL_MS ?? WAIT_POLL_MS);
    const thresholds: MachineThresholds =
        env.TOLARIA_MACHINE_WAIT_MAX_MS === undefined
            ? input.thresholds
            : {
                  ...input.thresholds,
                  waitMaxS: Number(env.TOLARIA_MACHINE_WAIT_MAX_MS) / 1000,
              };
    const t0 = now();
    let lastAnnounce: number | null = null;
    for (;;) {
        input.tick?.();
        const sample = probe();
        const waitedMs = now() - t0;
        const decision = gateAdmission({ sample, thresholds, waitedMs });
        if (decision.verdict === "admit") {
            if (lastAnnounce !== null)
                input.announce(
                    `${input.tag} machine calm after ${Math.round(waitedMs / 1000)}s — ${sampleLine(sample)}`
                );
            return {
                admitted: true,
                overridden: false,
                waitedMs,
                sample,
                reasons: [],
            };
        }
        if (env[GATE_OVERRIDE_ENV] === "1") {
            input.announce(
                `${input.tag} machine busy — ${sampleLine(sample)} (${decision.reasons.join("; ")}) — starting anyway: ${GATE_OVERRIDE_ENV}=1`
            );
            return {
                admitted: true,
                overridden: true,
                waitedMs,
                sample,
                reasons: decision.reasons,
            };
        }
        if (decision.verdict === "refuse") {
            input.announce(
                `${input.tag} machine still busy after ${Math.round(waitedMs / 1000)}s — ${sampleLine(sample)} (${decision.reasons.join("; ")}). Nothing ran: this is INFRA (machine-saturated), not a verdict on the tree. See \`bun run machine\`; the escape is ${GATE_OVERRIDE_ENV}=1.`
            );
            return {
                admitted: false,
                overridden: false,
                waitedMs,
                sample,
                reasons: decision.reasons,
            };
        }
        const t = now();
        if (lastAnnounce === null || t - lastAnnounce >= 60_000) {
            input.announce(
                `${input.tag} machine busy — ${sampleLine(sample)} (${decision.reasons.join("; ")}); waiting, bound ${Math.round(thresholds.waitMaxS)}s`
            );
            lastAnnounce = t;
        }
        await sleep(pollMs);
    }
}
