/**
 * The health verdict as SHARED state (issue #5462, ADR 0154 §9).
 *
 * A health verdict used to be a local file — `last.json` plus the `RED`
 * marker under `.claude/telemetry/health/` — so a second machine could not
 * see a red found on the first: its `queue:plan` kept picking from a tip it
 * could not know was broken. Every reader now goes through ONE interface,
 * `VerdictStore`, with two backends chosen by `tolaria.config.json`
 * (`health.verdictStore`):
 *
 *  - `file` (the default): today's layout, unchanged. `last.json` stays
 *    `health-main`'s run record (it writes it itself, with fields no store
 *    carries); the store owns the MARKERS — `RED`, and `AMBER` below.
 *  - `github`: a commit status on the gated sha, `context=health` — state
 *    success / failure / error / pending for GREEN / RED / infra / AMBER, the
 *    description `STATUS · step · machine[ · tests: …][ · log: …]`, the
 *    target URL the log when it is one. Read back with one GraphQL call over
 *    the base branch's history.
 *
 * Semantics, identical on both backends:
 *
 *  - **Last writer per sha wins** — except that an `infra` write never
 *    replaces a GREEN or RED for the same sha (an infra run proves nothing,
 *    so it may not erase what a completed run proved).
 *  - **AMBER.** A repair PR for a RED tip landed, AND its lane ran the
 *    failing test files the RED verdict names, explicitly (`land`'s repair
 *    proof). The lineage is then AMBER: picks and non-repair landings resume
 *    at once instead of waiting the 35–45 min a health run takes to confirm.
 *    The next GREEN clears it. A RED on an AMBER lineage is the SECOND RED —
 *    the repair did not hold — and stops the loop with a notification.
 *  - The **lineage** is the run of verdicts since the last GREEN, newest
 *    first in COMMIT order: a RED written late about a tip OLDER than the
 *    repair is not a second red (the repair is already ahead of it).
 *
 * Node builtins plus `lib/branches.ts` only: `health-main.ts` imports this,
 * and it runs before `node_modules` may exist.
 */
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH, CONFIG_PATH } from "./branches";
import type { HealthStatus } from "./health-verdict";

/** Where the file backend lives, relative to the primary checkout. */
export const HEALTH_DIR_REL = join(".claude", "telemetry", "health");

/** The GitHub commit-status context the verdict is written under. */
export const HEALTH_CONTEXT = "health";

/** A GitHub commit description is capped at 140 characters. */
export const DESCRIPTION_MAX = 140;

export type VerdictBackend = "file" | "github";

export type VerdictStatus = "green" | "red" | "infra" | "amber";

export interface Verdict {
    sha: string;
    /** `running` only ever comes back from the file backend's `last.json`. */
    status: VerdictStatus | HealthStatus;
    /** The failed step (`test:app`), or what a GREEN ran last. */
    step?: string;
    /** `os.hostname()` of the machine that wrote it. */
    machine?: string;
    /** Log pointer — a path on `machine`, or a URL. */
    log?: string;
    /** ISO time the verdict was written. */
    at?: string;
    /** RED only: the failing test FILES — what a repair's lane must run. */
    tests?: string[];
    /** AMBER only: the RED sha the repair landed against. */
    repairOf?: string;
    /** `infra` only: what to do (`INFRA_REMEDY`). */
    reason?: string;
}

/**
 * The lineage's state, the one thing a refusal reads:
 *  - `red` / `second-red` — refuse new picks and non-repair landings;
 *    `second-red` also stops the loop and notifies;
 *  - `amber` — a proved repair landed: resume, health confirms later;
 *  - `green` / `infra` / `none` — nothing to refuse on.
 */
export type LineageKind =
    | "none"
    | "green"
    | "infra"
    | "red"
    | "amber"
    | "second-red";

export interface Lineage {
    kind: LineageKind;
    /** The verdict the kind is about: the standing RED for `red` /
     *  `second-red`, the AMBER for `amber`, the newest otherwise. */
    verdict: Verdict | null;
}

export interface WriteOutcome {
    written: boolean;
    /** Why a write was declined. */
    reason?: string;
}

export interface VerdictStore {
    readonly backend: VerdictBackend;
    /** The verdict for one sha, or null when none was written. */
    read(sha: string): Verdict | null;
    write(verdict: Verdict): WriteOutcome;
    /** The verdict of the newest gated tip, or null. */
    latest(): Verdict | null;
    lineage(): Lineage;
}

/** Whether the lineage refuses a new pick / a non-repair landing. */
export function lineageBlocks(kind: LineageKind): boolean {
    return kind === "red" || kind === "second-red";
}

/** How long ago `v` was written, or null when it carries no time. */
export function verdictAgeMs(v: Verdict | null, now: number): number | null {
    if (!v?.at) return null;
    const at = Date.parse(v.at);
    return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

/** Last writer wins, except that `infra` never replaces a GREEN or RED. */
export function mayOverwrite(
    existing: Verdict | null,
    incoming: Verdict
): boolean {
    if (incoming.status !== "infra" || existing === null) return true;
    return existing.status !== "green" && existing.status !== "red";
}

/**
 * The lineage of a verdict history, NEWEST FIRST in commit order. Pure: the
 * GitHub backend hands it the base branch's history; the decision is the
 * same whatever the backend.
 */
export function lineageOf(history: readonly Verdict[]): Lineage {
    const decided = history.filter((v) => v.status !== "infra");
    const head = decided[0];
    if (head === undefined)
        return history.length === 0
            ? { kind: "none", verdict: null }
            : { kind: "infra", verdict: history[0] };
    if (head.status === "green") return { kind: "green", verdict: head };
    if (head.status === "amber") return { kind: "amber", verdict: head };
    if (head.status !== "red") return { kind: "none", verdict: head };
    // A RED. Second when an AMBER stands between it and the last GREEN.
    for (const v of decided.slice(1)) {
        if (v.status === "green") break;
        if (v.status === "amber") return { kind: "second-red", verdict: head };
    }
    return { kind: "red", verdict: head };
}

/** The failing test files named in a vitest run's output — what a repair's
 *  lane must run (`land`'s repair proof). Sorted, unique. */
export function failedTestFiles(output: string): string[] {
    // biome-ignore lint: ANSI escape
    const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
    const files = new Set<string>();
    const re =
        /^\s*(?:[❯>×✗]\s*)?FAIL\s+(?:\|[^|\n]+\|\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gm;
    for (const m of plain.matchAll(re)) files.add(m[1]);
    return [...files].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** `health.verdictStore` — absent reads `file`, anything else is an error. */
export function parseVerdictBackend(
    raw: string,
    source = CONFIG_PATH
): VerdictBackend {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
    }
    const health = (doc as { health?: unknown })?.health;
    if (health === undefined) return "file";
    const v = (health as { verdictStore?: unknown } | null)?.verdictStore;
    if (v === undefined) return "file";
    if (v === "file" || v === "github") return v;
    throw new Error(
        `${source}: health.verdictStore must be "file" or "github", got ${JSON.stringify(v)}`
    );
}

export function readVerdictBackend(path = CONFIG_PATH): VerdictBackend {
    return parseVerdictBackend(readFileSync(path, "utf8"), path);
}

// ─────────────────────────────────────────────────────────────────────────────
// File backend
// ─────────────────────────────────────────────────────────────────────────────

/** What the `AMBER` marker holds. */
interface AmberRecord {
    sha: string;
    repairOf?: string;
    machine?: string;
    at?: string;
}

function readJson<T>(path: string): T | null {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
        return null;
    }
}

/** `last.json` as a verdict: a `running` record stands for the one it
 *  replaced (`prior`) where it carries one. */
function lastAsVerdict(dir: string): Verdict | null {
    const last = readJson<
        Verdict & { failedStep?: string; finishedAt?: string; prior?: Verdict }
    >(join(dir, "last.json"));
    if (!last || typeof last.sha !== "string") return null;
    return {
        ...last,
        step: last.failedStep ?? last.step,
        at: last.finishedAt ?? last.at,
    };
}

function amberAsVerdict(dir: string): Verdict | null {
    const a = readJson<AmberRecord>(join(dir, "AMBER"));
    if (!a || typeof a.sha !== "string") return null;
    return { ...a, status: "amber" };
}

export interface FileStoreOptions {
    /** The primary checkout. */
    root: string;
    /** `git merge-base --is-ancestor a b` in `root` — injectable for tests. */
    isAncestor?: (a: string, b: string) => boolean;
    /** The branch the RED marker names. */
    branch?: string;
}

/**
 * Today's layout. The `RED` marker is the verdict (its presence is what every
 * reader refused on); `AMBER` is new and holds the repair's JSON record.
 * `last.json` is read for the explanation, never written here.
 */
export function fileVerdictStore(opts: FileStoreOptions): VerdictStore {
    const dir = join(opts.root, HEALTH_DIR_REL);
    const red = join(dir, "RED");
    const amber = join(dir, "AMBER");
    const isAncestor =
        opts.isAncestor ??
        ((a: string, b: string) =>
            spawnSync("git", ["merge-base", "--is-ancestor", a, b], {
                cwd: opts.root,
            }).status === 0);
    const store: VerdictStore = {
        backend: "file",
        read(sha) {
            const a = amberAsVerdict(dir);
            if (a?.sha === sha) return a;
            const last = lastAsVerdict(dir);
            if (last?.sha === sha && last.status !== "running") return last;
            return null;
        },
        write(v) {
            mkdirSync(dir, { recursive: true });
            if (v.status === "green") {
                rmSync(red, { force: true });
                rmSync(amber, { force: true });
                return { written: true };
            }
            if (v.status === "red") {
                const a = amberAsVerdict(dir);
                // A late RED about a tip the repair is already ahead of.
                if (a && a.sha !== v.sha && isAncestor(v.sha, a.sha))
                    return {
                        written: false,
                        reason: `RED @ ${v.sha.slice(0, 8)} is older than the repair AMBER @ ${a.sha.slice(0, 8)}`,
                    };
                writeFileSync(
                    red,
                    `${opts.branch ?? BASE_BRANCH} @ ${v.sha} red at ${v.step ?? "unknown step"} — log: ${v.log ?? "none"}\n`
                );
                return { written: true };
            }
            if (v.status === "amber") {
                const record: AmberRecord = {
                    sha: v.sha,
                    repairOf: v.repairOf,
                    machine: v.machine,
                    at: v.at,
                };
                writeFileSync(amber, JSON.stringify(record, null, 2));
                rmSync(red, { force: true });
                return { written: true };
            }
            // infra: `last.json` is the caller's (`recordInfra`), and an infra
            // run neither raises nor clears a marker.
            return { written: true };
        },
        latest() {
            const a = amberAsVerdict(dir);
            const last = lastAsVerdict(dir);
            const decided =
                last?.status === "running"
                    ? ((last as { prior?: Verdict }).prior ?? null)
                    : last;
            if (a && (!decided || decided.sha === a.sha)) return a;
            if (a && decided && isAncestor(decided.sha, a.sha)) return a;
            return decided;
        },
        lineage() {
            const redStands = existsSync(red);
            const a = amberAsVerdict(dir);
            const last = lastAsVerdict(dir);
            if (redStands)
                return {
                    kind: a ? "second-red" : "red",
                    // The raw record, `running` included: `health:fix`
                    // refuses to race a run that is re-gating the tip.
                    verdict: last,
                };
            if (a) return { kind: "amber", verdict: a };
            const decided =
                last?.status === "running"
                    ? ((last as { prior?: Verdict }).prior ?? null)
                    : last;
            if (decided?.status === "green")
                return { kind: "green", verdict: decided };
            if (decided?.status === "infra")
                return { kind: "infra", verdict: decided };
            return { kind: "none", verdict: decided };
        },
    };
    return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub backend
// ─────────────────────────────────────────────────────────────────────────────

export interface GhResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Runs `gh <args>`; injectable so tests drive the backend with a fake. */
export type GhRunner = (args: string[]) => GhResult;

export const realGh: GhRunner = (args) => {
    const r = spawnSync("gh", args, { encoding: "utf8", timeout: 30_000 });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? r.error?.message ?? "",
    };
};

type GhState = "success" | "failure" | "error" | "pending";

const STATE_OF: Record<VerdictStatus, GhState> = {
    green: "success",
    red: "failure",
    infra: "error",
    amber: "pending",
};

const STATUS_OF: Record<string, VerdictStatus> = {
    success: "green",
    failure: "red",
    error: "infra",
    pending: "amber",
};

const SEP = " · ";

/** The commit-status description: `STATUS · step · machine`, then the
 *  optional fields while they fit in `DESCRIPTION_MAX` — whole, never cut. */
export function encodeDescription(v: Verdict): string {
    let out = [
        (v.status as string).toUpperCase(),
        v.step ?? "-",
        v.machine ?? "-",
    ].join(SEP);
    const extras: string[] = [];
    if (v.repairOf) extras.push(`repair-of: ${v.repairOf}`);
    if (v.log && !isUrl(v.log)) extras.push(`log: ${v.log}`);
    for (const extra of extras)
        if (out.length + SEP.length + extra.length <= DESCRIPTION_MAX)
            out += SEP + extra;
    // Tests last, as many whole paths as fit: a repair proof runs those.
    const tests: string[] = [];
    for (const t of v.tests ?? []) {
        const next = `tests: ${[...tests, t].join(",")}`;
        if (out.length + SEP.length + next.length > DESCRIPTION_MAX) break;
        tests.push(t);
    }
    if (tests.length > 0) out += `${SEP}tests: ${tests.join(",")}`;
    return out;
}

/** Inverse of `encodeDescription`; `state` decides the status. */
export function decodeStatus(input: {
    sha: string;
    state: string;
    description: string | null;
    targetUrl: string | null;
    createdAt: string | null;
}): Verdict | null {
    const status = STATUS_OF[input.state.toLowerCase()];
    if (status === undefined) return null;
    const [, step, machine, ...rest] = (input.description ?? "").split(SEP);
    const v: Verdict = { sha: input.sha, status };
    if (step && step !== "-") v.step = step;
    if (machine && machine !== "-") v.machine = machine;
    if (input.createdAt) v.at = input.createdAt;
    if (input.targetUrl) v.log = input.targetUrl;
    for (const field of rest) {
        const m = /^([a-z-]+): (.*)$/.exec(field);
        if (!m) continue;
        if (m[1] === "tests") v.tests = m[2].split(",").filter(Boolean);
        if (m[1] === "repair-of") v.repairOf = m[2];
        if (m[1] === "log" && !v.log) v.log = m[2];
    }
    return v;
}

function isUrl(s: string): boolean {
    return /^https?:\/\//.test(s);
}

/** `owner/name` from the origin remote URL (ssh or https). */
export function repoFromRemote(url: string): string | null {
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(
        url.trim()
    );
    return m ? m[1] : null;
}

/** Commits of base history the lineage reads — far more than one batch. */
export const HISTORY_DEPTH = 60;

const HISTORY_QUERY = `query($owner:String!,$name:String!,$ref:String!,$n:Int!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{history(first:$n){nodes{oid status{context(name:"${HEALTH_CONTEXT}"){state description targetUrl createdAt}}}}}}}}}`;

export interface GithubStoreOptions {
    /** `owner/name`. */
    repo: string;
    /** The branch whose history is the lineage. */
    branch?: string;
    run?: GhRunner;
}

function ghJson<T>(run: GhRunner, args: string[]): T {
    const r = run(args);
    if (r.status !== 0)
        throw new Error(
            `gh ${args.slice(0, 2).join(" ")} failed (exit ${r.status}): ${r.stderr.trim()}`
        );
    return JSON.parse(r.stdout) as T;
}

/**
 * The commit-status backend. Every read is a network call and THROWS when
 * GitHub does not answer; each consumer decides what an unreadable store
 * means for it (`readVerdictLineage`).
 */
export function githubVerdictStore(opts: GithubStoreOptions): VerdictStore {
    const run = opts.run ?? realGh;
    const branch = opts.branch ?? BASE_BRANCH;
    const [owner, name] = opts.repo.split("/");
    const history = (): Verdict[] => {
        type Node = {
            oid: string;
            status: {
                context: {
                    state: string;
                    description: string | null;
                    targetUrl: string | null;
                    createdAt: string | null;
                } | null;
            } | null;
        };
        const doc = ghJson<{
            data?: {
                repository?: {
                    ref?: {
                        target?: { history?: { nodes?: Node[] } };
                    } | null;
                };
            };
        }>(run, [
            "api",
            "graphql",
            "-f",
            `query=${HISTORY_QUERY}`,
            "-F",
            `owner=${owner}`,
            "-F",
            `name=${name}`,
            "-F",
            `ref=refs/heads/${branch}`,
            "-F",
            `n=${HISTORY_DEPTH}`,
        ]);
        const nodes = doc.data?.repository?.ref?.target?.history?.nodes ?? [];
        const out: Verdict[] = [];
        for (const n of nodes) {
            const c = n.status?.context;
            if (!c) continue;
            const v = decodeStatus({ sha: n.oid, ...c });
            if (v) out.push(v);
        }
        return out;
    };
    const store: VerdictStore = {
        backend: "github",
        read(sha) {
            const list = ghJson<
                Array<{
                    context: string;
                    state: string;
                    description: string | null;
                    target_url: string | null;
                    created_at: string | null;
                }>
            >(run, [
                "api",
                `repos/${opts.repo}/commits/${sha}/statuses?per_page=100`,
            ]);
            // Newest first: the last writer wins.
            const s = list.find((x) => x.context === HEALTH_CONTEXT);
            if (!s) return null;
            return decodeStatus({
                sha,
                state: s.state,
                description: s.description,
                targetUrl: s.target_url,
                createdAt: s.created_at,
            });
        },
        write(v) {
            if (v.status === "running")
                return { written: false, reason: "running is not a verdict" };
            if (v.status === "infra") {
                const existing = store.read(v.sha);
                if (!mayOverwrite(existing, v))
                    return {
                        written: false,
                        reason: `infra never overwrites ${existing?.status.toUpperCase()} @ ${v.sha.slice(0, 8)}`,
                    };
            }
            const args = [
                "api",
                "-X",
                "POST",
                `repos/${opts.repo}/statuses/${v.sha}`,
                "-f",
                `state=${STATE_OF[v.status as VerdictStatus]}`,
                "-f",
                `context=${HEALTH_CONTEXT}`,
                "-f",
                `description=${encodeDescription(v)}`,
            ];
            if (v.log && isUrl(v.log)) args.push("-f", `target_url=${v.log}`);
            const r = run(args);
            if (r.status !== 0)
                throw new Error(
                    `gh api statuses failed (exit ${r.status}): ${r.stderr.trim()}`
                );
            return { written: true };
        },
        latest() {
            return history()[0] ?? null;
        },
        lineage() {
            return lineageOf(history());
        },
    };
    return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// The one factory every consumer calls
// ─────────────────────────────────────────────────────────────────────────────

/** The machine name a verdict records. */
export function machineName(): string {
    return hostname().replace(/\.local$/, "");
}

function originRepo(root: string): string {
    const r = spawnSync("git", ["remote", "get-url", "origin"], {
        cwd: root,
        encoding: "utf8",
    });
    const repo = r.status === 0 ? repoFromRemote(r.stdout) : null;
    if (repo === null)
        throw new Error(
            `health.verdictStore is "github" but the origin remote of ${root} names no GitHub repository`
        );
    return repo;
}

/**
 * The store `tolaria.config.json` selects, rooted at the primary checkout
 * (where the file backend lives). `TOLARIA_VERDICT_STORE` overrides the
 * config for one process — a test, or a hand-run read of the other backend.
 */
export function verdictStore(
    root: string,
    opts: { backend?: VerdictBackend; run?: GhRunner; branch?: string } = {}
): VerdictStore {
    const env = process.env.TOLARIA_VERDICT_STORE;
    const backend =
        opts.backend ??
        (env === "file" || env === "github" ? env : readVerdictBackend());
    if (backend === "github")
        return githubVerdictStore({
            repo: originRepo(root),
            branch: opts.branch,
            run: opts.run,
        });
    return fileVerdictStore({ root, branch: opts.branch });
}

/**
 * The lineage, total: a store that cannot be read (GitHub down, a torn
 * config) reads as `none` with the error, never a throw — a 502 must not
 * refuse every pick, nor block a landing. Callers print `error`.
 */
export function readVerdictLineage(store: () => VerdictStore): Lineage & {
    error?: string;
} {
    try {
        return store().lineage();
    } catch (e) {
        return { kind: "none", verdict: null, error: (e as Error).message };
    }
}
