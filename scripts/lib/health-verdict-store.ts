/**
 * The health verdict as SHARED state (issue #5462, ADR 0154 §9).
 *
 * A health verdict used to be a local file — `last.json` plus the `RED`
 * marker under `.claude/telemetry/health/` — so a second machine could not
 * see a red found on the first: its `queue:plan` kept picking from a tip it
 * could not know was broken. Every reader now goes through ONE interface,
 * `VerdictStore`, a commit status on the gated sha, `context=health` — state
 * success / failure / error / pending for GREEN / RED / infra / AMBER, the
 * description `STATUS · step · machine[ · tests: …][ · log: …]`, the target
 * URL the log when it is one. Read back with one GraphQL call over the base
 * branch's history. (A second, local-file backend lived here until issue
 * #5655: with the pass and the workflows on GitHub, one machine's files no
 * longer carry a verdict.) `health-main` keeps writing its own run record,
 * `last.json`, beside its logs — a record no store carries.
 *
 * Semantics:
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
import { hostname } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH } from "./branches";
import { failingFiles, isEvidenceFor } from "./health-evidence";
import type { HealthStatus } from "./health-verdict";

/** Where `health-main`'s run record and logs live, relative to the primary checkout. */
export const HEALTH_DIR_REL = join(".claude", "telemetry", "health");

/** The GitHub commit-status context the verdict is written under. */
export const HEALTH_CONTEXT = "health";

/** A GitHub commit description is capped at 140 characters. */
export const DESCRIPTION_MAX = 140;

export type VerdictBackend = "github";

export type VerdictStatus = "green" | "red" | "infra" | "amber";

export interface Verdict {
    sha: string;
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
    /** RED only: what KIND of failure it was (`FailureKind`, issue #5589) —
     *  so a RED naming no test says why instead of saying nothing. */
    failure?: string;
    /** AMBER only: the RED sha the repair landed against. */
    repairOf?: string;
    /** `infra` only: what to do (`INFRA_REMEDY`). */
    reason?: string;
    /** The `health-fix` context only: the `/health-fix` issues recorded
     *  against this RED sha (issue #5593) — what `land` reads to recognise
     *  the closing PR as a repair, from whichever machine recorded them. */
    issues?: number[];
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

/** Last writer wins, except that `infra` never replaces a GREEN, a RED or
 *  an AMBER: the lineage skips infra, so an infra over AMBER would bring the
 *  repaired RED back (a saturated confirming run, review of issue #5462). */
export function mayOverwrite(
    existing: Verdict | null,
    incoming: Verdict
): boolean {
    if (incoming.status !== "infra" || existing === null) return true;
    return (
        existing.status !== "green" &&
        existing.status !== "red" &&
        existing.status !== "amber"
    );
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
    return failingFiles(output);
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
 *  optional fields while they fit in `DESCRIPTION_MAX` — whole, never cut.
 *  The failing tests come BEFORE a local log path: they are what a repair
 *  proof runs, and a ~70-character path read first left no room for one. */
export function encodeDescription(v: Verdict): string {
    let out = [
        (v.status as string).toUpperCase(),
        v.step ?? "-",
        v.machine ?? "-",
    ].join(SEP);
    const fit = (extra: string) => {
        if (out.length + SEP.length + extra.length <= DESCRIPTION_MAX)
            out += SEP + extra;
    };
    if (v.repairOf) fit(`repair-of: ${v.repairOf}`);
    if (v.failure) fit(`failure: ${v.failure}`);
    const tests: string[] = [];
    for (const t of v.tests ?? []) {
        const next = `tests: ${[...tests, t].join(",")}`;
        if (out.length + SEP.length + next.length > DESCRIPTION_MAX) break;
        tests.push(t);
    }
    if (tests.length > 0) out += `${SEP}tests: ${tests.join(",")}`;
    if (v.issues && v.issues.length > 0) fit(`issues: ${v.issues.join(",")}`);
    if (v.log && !isUrl(v.log)) fit(`log: ${v.log}`);
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
        if (m[1] === "issues")
            v.issues = m[2]
                .split(",")
                .map(Number)
                .filter((n) => Number.isInteger(n) && n > 0);
        if (m[1] === "failure") v.failure = m[2];
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

const historyQuery = (context: string) =>
    `query($owner:String!,$name:String!,$ref:String!,$n:Int!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{history(first:$n){nodes{oid status{context(name:"${context}"){state description targetUrl createdAt}}}}}}}}}`;

export interface GithubStoreOptions {
    /** `owner/name`. */
    repo: string;
    /** The branch whose history is the lineage. */
    branch?: string;
    run?: GhRunner;
    /** The commit-status context; `health` unless a caller names another. */
    context?: string;
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
    const context = opts.context ?? HEALTH_CONTEXT;
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
            `query=${historyQuery(context)}`,
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
            const s = list.find((x) => x.context === context);
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
                `context=${context}`,
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

/** The mark a GitHub-hosted runner's machine name carries (issue #5858):
 *  its hostname is an ephemeral VM's, so without it a hosted verdict reads
 *  like any other machine's and the ladder cannot tell the runner class. */
export const HOSTED_MACHINE_PREFIX = "github-hosted/";

/** The machine name a verdict records — prefixed on a GitHub-hosted runner. */
export function machineName(env: NodeJS.ProcessEnv = process.env): string {
    const host = hostname().replace(/\.local$/, "");
    return env.GITHUB_ACTIONS === "true" &&
        env.RUNNER_ENVIRONMENT === "github-hosted"
        ? `${HOSTED_MACHINE_PREFIX}${host}`
        : host;
}

export function originRepo(root: string): string {
    // `gh`'s own override (`OWNER/REPO`): a checkout whose origin is not the
    // repository the store lives on — a fixture, a mirror — names it here.
    const pinned = process.env.GH_REPO;
    if (pinned && /^[^/\s]+\/[^/\s]+$/.test(pinned)) return pinned;
    const r = spawnSync("git", ["remote", "get-url", "origin"], {
        cwd: root,
        encoding: "utf8",
    });
    const repo = r.status === 0 ? repoFromRemote(r.stdout) : null;
    if (repo === null)
        throw new Error(
            `the origin remote of ${root} names no GitHub repository`
        );
    return repo;
}

/**
 * The store of the repository `root` is a checkout of — its origin remote.
 * `branch` is the base branch unless a test says otherwise.
 */
export function verdictStore(
    root: string,
    opts: { run?: GhRunner; branch?: string } = {}
): VerdictStore {
    return githubVerdictStore({
        repo: originRepo(root),
        branch: opts.branch,
        run: opts.run,
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// The RED evidence, on the same pivot as the verdict (issue #5589)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a RED's evidence (`lib/health-evidence.ts`) lives so EITHER machine
 * reads it: a commit comment on the gated sha — the same repository, the same
 * token scope as the commit status, found by the sha alone.
 *
 * `publish` returns the pointer the verdict carries in `log` (the comment's
 * URL, or the file's path) and THROWS when it could not publish; `read`
 * returns the newest body for a sha, or null when none was published.
 */
export interface EvidenceStore {
    readonly backend: VerdictBackend;
    publish(sha: string, body: string): string;
    read(sha: string): string | null;
}

export function githubEvidenceStore(opts: {
    repo: string;
    run?: GhRunner;
}): EvidenceStore {
    const run = opts.run ?? realGh;
    return {
        backend: "github",
        publish(sha, body) {
            const r = run([
                "api",
                "-X",
                "POST",
                `repos/${opts.repo}/commits/${sha}/comments`,
                "-f",
                `body=${body}`,
                "--jq",
                ".html_url",
            ]);
            const url = r.stdout.trim();
            if (r.status !== 0 || !isUrl(url))
                throw new Error(
                    `gh api commit comment failed (exit ${r.status}): ${r.stderr.trim() || "no URL returned"}`
                );
            return url;
        },
        read(sha) {
            const list = ghJson<Array<{ body: string | null }>>(run, [
                "api",
                `repos/${opts.repo}/commits/${sha}/comments?per_page=100`,
            ]);
            // Oldest first: the newest evidence (a re-gated sha) wins.
            const mine = list.filter((c) => isEvidenceFor(c.body, sha));
            return mine.length > 0
                ? (mine[mine.length - 1].body ?? null)
                : null;
        },
    };
}

/** The evidence store of the repository `root` is a checkout of. */
export function evidenceStore(
    root: string,
    opts: { run?: GhRunner } = {}
): EvidenceStore {
    return githubEvidenceStore({ repo: originRepo(root), run: opts.run });
}
