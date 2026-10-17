/**
 * Who tried to repair a RED tip, and how it ended — on the SAME pivot as the
 * verdict (issue #5589), so the machine that did not run the fixer still
 * sees it and never re-attempts what the other one tried.
 *
 * One record per RED sha — the LATEST rung tried on it, numbered: on the
 * github backend a commit status on that sha under
 * `context=health-fix-attempt` (pending = attempting, success = landed,
 * failure = stuck); on the file backend `fix-attempts.json` under the health
 * telemetry directory. Its own context, never `health-fix`: that one holds
 * the sha's repair ISSUES (`lib/health-pivot.ts`), and a combined status
 * keeps one status per context — an outcome written there erased the issues
 * the queue admits the fixer's PR by (issue #5646). `health:fix` writes `attempting` before it spawns the
 * fixer and the parsed verdict after (`parseVerdict`, fail-closed), and
 * `loop-drain.sh` asks `loopFixDecision` what to do about a standing RED.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    configuredBackend,
    DESCRIPTION_MAX,
    HEALTH_DIR_REL,
    originRepo,
    realGh,
    type GhRunner,
    type VerdictBackend,
} from "./health-verdict-store";

/** The commit-status context a fix attempt is recorded under. */
export const FIX_CONTEXT = "health-fix-attempt";

export const FIX_ATTEMPTS_FILE = "fix-attempts.json";

export type FixOutcome = "attempting" | "landed" | "stuck";

/** Which rung of the RED ladder the record is about (issue #5646): the
 *  headless fixer, the revert of the culprit, or the stop's marker (written
 *  before its issue, so it emails once). Absent reads `fix`. */
export type FixRung = "fix" | "revert" | "stop";

export interface FixAttempt {
    /** The RED sha the fixer was asked about. */
    sha: string;
    outcome: FixOutcome;
    /** Absent: `fix` (records written before the ladder). */
    rung?: FixRung;
    /** 1-based attempt of `rung` on this RED episode; absent reads 1. */
    attempt?: number;
    machine?: string;
    /** ISO time the record was written. */
    at?: string;
    pr?: number;
    note?: string;
}

export interface FixAttemptStore {
    readonly backend: VerdictBackend;
    read(sha: string): FixAttempt | null;
    /** Throws when the pivot did not take it. */
    write(a: FixAttempt): void;
}

const STATE_OF: Record<FixOutcome, string> = {
    attempting: "pending",
    landed: "success",
    stuck: "failure",
};

const OUTCOME_OF: Record<string, FixOutcome> = {
    pending: "attempting",
    success: "landed",
    failure: "stuck",
};

const SEP = " · ";

const RUNG_SEGMENT = /^(fix|revert|stop) (\d+)$/;

/** `LANDED · machine · fix 2 · PR #N · note`, cut to the 140-character cap.
 *  The rung segment is written only when the record names one. */
export function encodeFixDescription(a: FixAttempt): string {
    const parts = [a.outcome.toUpperCase(), a.machine ?? "-"];
    if (a.rung !== undefined) parts.push(`${a.rung} ${a.attempt ?? 1}`);
    if (a.pr !== undefined) parts.push(`PR #${a.pr}`);
    if (a.note) parts.push(a.note.replace(/\s+/g, " "));
    const out = parts.join(SEP);
    return out.length <= DESCRIPTION_MAX
        ? out
        : `${out.slice(0, DESCRIPTION_MAX - 1)}…`;
}

export function decodeFixStatus(input: {
    sha: string;
    state: string;
    description: string | null;
    createdAt: string | null;
}): FixAttempt | null {
    const outcome = OUTCOME_OF[input.state.toLowerCase()];
    if (outcome === undefined) return null;
    const [, machine, ...rest] = (input.description ?? "").split(SEP);
    const a: FixAttempt = { sha: input.sha, outcome };
    if (machine && machine !== "-") a.machine = machine;
    if (input.createdAt) a.at = input.createdAt;
    const rung = rest.length > 0 ? RUNG_SEGMENT.exec(rest[0]) : null;
    if (rung) {
        a.rung = rung[1] as FixRung;
        a.attempt = Number(rung[2]);
        rest.shift();
    }
    const pr = rest.length > 0 ? /^PR #(\d+)$/.exec(rest[0]) : null;
    if (pr) {
        a.pr = Number(pr[1]);
        rest.shift();
    }
    if (rest.length > 0) a.note = rest.join(SEP);
    return a;
}

export function githubFixAttemptStore(opts: {
    repo: string;
    run?: GhRunner;
}): FixAttemptStore {
    const run = opts.run ?? realGh;
    return {
        backend: "github",
        read(sha) {
            // The COMBINED status: the latest status per context, so a sha
            // with 100+ statuses cannot push `health-fix` off a page.
            const r = run([
                "api",
                `repos/${opts.repo}/commits/${sha}/status`,
                "--jq",
                ".statuses",
            ]);
            if (r.status !== 0)
                throw new Error(
                    `gh api statuses failed (exit ${r.status}): ${r.stderr.trim()}`
                );
            const list = JSON.parse(r.stdout) as Array<{
                context: string;
                state: string;
                description: string | null;
                created_at: string | null;
            }>;
            // Newest first: the last writer wins.
            const s = list.find((x) => x.context === FIX_CONTEXT);
            return s
                ? decodeFixStatus({
                      sha,
                      state: s.state,
                      description: s.description,
                      createdAt: s.created_at,
                  })
                : null;
        },
        write(a) {
            const r = run([
                "api",
                "-X",
                "POST",
                `repos/${opts.repo}/statuses/${a.sha}`,
                "-f",
                `state=${STATE_OF[a.outcome]}`,
                "-f",
                `context=${FIX_CONTEXT}`,
                "-f",
                `description=${encodeFixDescription(a)}`,
            ]);
            if (r.status !== 0)
                throw new Error(
                    `gh api statuses failed (exit ${r.status}): ${r.stderr.trim()}`
                );
        },
    };
}

export function fileFixAttemptStore(root: string): FixAttemptStore {
    const path = join(root, HEALTH_DIR_REL, FIX_ATTEMPTS_FILE);
    // A file that exists and does not parse THROWS: an unreadable record
    // must stop the loop (`loopFixDecision`), never read as "no attempt" —
    // nor be overwritten, dropping every other sha's record.
    const all = (): Record<string, FixAttempt> => {
        if (!existsSync(path)) return {};
        const doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (typeof doc !== "object" || doc === null || Array.isArray(doc))
            throw new Error(`${path} is not a JSON object`);
        return doc as Record<string, FixAttempt>;
    };
    return {
        backend: "file",
        read(sha) {
            return all()[sha] ?? null;
        },
        write(a) {
            mkdirSync(join(root, HEALTH_DIR_REL), { recursive: true });
            writeFileSync(
                path,
                `${JSON.stringify({ ...all(), [a.sha]: a }, null, 2)}\n`
            );
        },
    };
}

/** The store on the backend the verdict store uses. */
export function fixAttemptStore(
    root: string,
    opts: { backend?: VerdictBackend; run?: GhRunner } = {}
): FixAttemptStore {
    const env = process.env.TOLARIA_VERDICT_STORE;
    const backend =
        opts.backend ??
        (env === "file" || env === "github" ? env : configuredBackend());
    return backend === "github"
        ? githubFixAttemptStore({ repo: originRepo(root), run: opts.run })
        : fileFixAttemptStore(root);
}

/** Repairs one unattended run may attempt — `release`'s bound
 *  (`DEFAULT_FIX_ATTEMPTS`), restated because `release.ts` imports
 *  `health-fix.ts`, which imports this; a test pins the two together. */
export const LOOP_FIX_ATTEMPTS = 3;

/** How long a landed repair may leave its RED standing before the loop
 *  stops waiting for health to confirm it: the batch rule's 8 h (ADR 0154). */
export const LANDED_WAIT_MAX_MS = 8 * 60 * 60 * 1000;

export type LoopFixDecision =
    | { kind: "attempt" }
    | { kind: "wait"; why: string }
    | { kind: "stop"; why: string };

/**
 * What an unattended loop does about a standing RED on `sha` (issue #5589):
 * attempt ONE headless repair per tip, within the run's bound; wait while a
 * landed repair awaits health on its own tip; stop on anything else — a
 * stuck fixer, an attempt that never finished, the bound, an unreadable
 * record (never a second fixer on a tip whose first attempt it cannot see).
 */
export function loopFixDecision(input: {
    record: FixAttempt | null;
    /** The record could not be read — the pivot did not answer. */
    error?: string;
    attemptsThisRun: number;
    max: number;
    now: number;
}): LoopFixDecision {
    const { record } = input;
    if (input.error)
        return {
            kind: "stop",
            why: `the fix-attempt record could not be read — ${input.error}`,
        };
    if (record === null)
        return input.attemptsThisRun >= input.max
            ? {
                  kind: "stop",
                  why: `this run already attempted ${input.attemptsThisRun} repair(s), the bound`,
              }
            : { kind: "attempt" };
    const who = `${record.machine ?? "an unnamed machine"}${record.at ? ` at ${record.at}` : ""}`;
    if (record.outcome === "stuck")
        return {
            kind: "stop",
            why: `the fixer on ${who} was STUCK${record.note ? `: ${record.note}` : ""}`,
        };
    if (record.outcome === "attempting")
        return {
            kind: "stop",
            why: `a repair started on ${who} never recorded its outcome — running elsewhere, or killed`,
        };
    const at = record.at ? Date.parse(record.at) : NaN;
    if (Number.isFinite(at) && input.now - at > LANDED_WAIT_MAX_MS)
        return {
            kind: "stop",
            why: `a repair landed on ${who}${record.pr ? ` (PR #${record.pr})` : ""} and no health verdict has cleared the RED since`,
        };
    return {
        kind: "wait",
        why: `a repair landed on ${who}${record.pr ? ` (PR #${record.pr})` : ""} — health confirms on its tip`,
    };
}
