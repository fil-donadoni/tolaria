/**
 * Base-drift preflight (issue #6647): "rebase first, verify after".
 *
 * WHY. The base moves every 18–35 min in active hours (2.6 PR merges/h plus
 * `derive:sync` / `gaps:sync` / `bot-replay` commits). Measured over
 * 2026-10-21 → 10-24: of 33 passes with an expensive verify step, 27 did not
 * rebase before it (~216 min of `oracle:compile` redone after a late rebase);
 * 8 repairs re-failed within 2 h of their verify because the base had moved
 * under them; of 82 `land-failed` events, 40 were rebase-driven. Nothing
 * between pick and merge asked whether the base moved, or whether it touched
 * what the branch touches. This module asks, in seconds, against a freshly
 * fetched base. Four answers:
 *
 *   1. how many base commits the branch is behind;
 *   2. which files BOTH the base (since the merge-base) and the branch changed;
 *   3. which coupled derived or census artefacts the base changed — the list
 *      comes from the artefacts' OWNERS (`derive-sync.ts` and the census
 *      ledgers' modules), never a hand-kept copy;
 *   4. which open PRs that are queued, in a Mergify draft or `ready-to-land`
 *      touch the files this branch touches.
 *
 * Wired at three points: `/next-ticket` §3 before the review subagent
 * (`bun run base:drift --rebase`), `land:ready`'s step 0
 * (`preflightLandReady`), and the last step of a `--resume` repair before its
 * push. The preflight writes a small receipt (`writeReceipt`) — branch head,
 * the base sha it was verified against, the overlap set — for later steps and
 * the incremental re-verify issue to read.
 *
 * Pure decisions here; `scripts/base-drift.ts` and `land-ready.ts` do the
 * git and the `gh` I/O through the `DriftGit` seam.
 */
import { AI_EFFECTS_BASELINE_PATH } from "./ai-effects-baseline";
import { BLADE_CARD_INDEX_PATH } from "./blade-card-index";
import { CLAIMS_PATH } from "./coverage-context";
import { LEDGER_PATH as CR_LEDGER_PATH } from "./cr-ledger";
import {
    BOT_REPLAY_PATHS,
    CARD_INDEX_PATH,
    DERIVED_PATHS,
} from "./derive-sync";
import { READY_LABEL } from "./land-labels";
import { REGRESSION_LEDGER_PATH } from "./oracle-state-regressions";
import { RETIREMENT_LEDGER_PATH } from "./oracle-retirements";
import { isMergifyQueuePr, MERGIFY_QUEUED_LABEL } from "./pr-gate";

/** The inputs of the card-derived artefacts: a change here moves them. */
const CARD_INPUTS = /^convex\/(cards|gre)\//;

/**
 * One artefact whose bytes summarise more of the tree than the lines a PR
 * writes into it: `path` is the owner's constant, `regenerate` the command
 * that rewrites it (null when it is hand-kept rows: the merge is textual),
 * `inputs` the paths whose change moves it. The base changing it is COUPLED
 * to this branch when the branch changed it too, or changed one of its
 * inputs — a rebase then leaves the artefact owed a regeneration, which the
 * lane would only report minutes later as a red.
 */
export interface CoupledArtefact {
    path: string;
    regenerate: string | null;
    inputs: RegExp | null;
}

/** The derived-path owner's list (ADR 0157) plus the census ledgers. */
export const COUPLED_ARTEFACTS: readonly CoupledArtefact[] = [
    ...DERIVED_PATHS.map((path) => ({
        path,
        regenerate: "bun run derive:regenerate",
        inputs: CARD_INPUTS,
    })),
    {
        path: CARD_INDEX_PATH,
        regenerate: "bun run oracle:index",
        inputs: CARD_INPUTS,
    },
    { path: CLAIMS_PATH, regenerate: null, inputs: CARD_INPUTS },
    { path: RETIREMENT_LEDGER_PATH, regenerate: null, inputs: CARD_INPUTS },
    { path: REGRESSION_LEDGER_PATH, regenerate: null, inputs: CARD_INPUTS },
    { path: BLADE_CARD_INDEX_PATH, regenerate: null, inputs: CARD_INPUTS },
    {
        path: AI_EFFECTS_BASELINE_PATH,
        regenerate: "bun run ai:allowlist",
        inputs: CARD_INPUTS,
    },
    { path: CR_LEDGER_PATH, regenerate: null, inputs: null },
];

/** Every coupled path, for the owners' pin test. */
export const COUPLED_PATHS: readonly string[] = COUPLED_ARTEFACTS.map(
    (a) => a.path
);

/** The derived owner's whole list, re-exported for the pin test: every
 *  path `derive:sync` / the Bot replay writes is a coupled artefact. */
export const DERIVED_OWNER_PATHS: readonly string[] = BOT_REPLAY_PATHS;

/** What `git` the measurement needs — a seam for the test. */
export interface DriftGit {
    /** `git <args>` in the worktree; throws on failure. */
    run: (args: string[]) => string;
}

/** The raw measurement against a fetched base ref. */
export interface DriftMeasure {
    branch: string;
    branchHead: string;
    base: string;
    baseSha: string;
    mergeBase: string;
    behind: number;
    baseChanged: string[];
    branchChanged: string[];
}

function lines(out: string): string[] {
    return out.split("\n").filter((l) => l !== "");
}

/**
 * Measure the branch at `HEAD` against `base` (already fetched: the caller
 * owns the one `git fetch`). Three git reads after the merge-base.
 */
export function measureDrift(git: DriftGit, base: string): DriftMeasure {
    const branchHead = git.run(["rev-parse", "HEAD"]).trim();
    const branch = git.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const baseSha = git.run(["rev-parse", base]).trim();
    const mergeBase = git.run(["merge-base", "HEAD", base]).trim();
    const behind = Number(
        git.run(["rev-list", "--count", `${mergeBase}..${base}`]).trim()
    );
    return {
        branch,
        branchHead,
        base,
        baseSha,
        mergeBase,
        behind,
        // `--no-renames`: a rename on one side must show its OLD path too,
        // or a branch editing that path reads as "nothing shared".
        baseChanged: lines(
            git.run(["diff", "--name-only", "--no-renames", mergeBase, base])
        ),
        branchChanged: lines(
            git.run(["diff", "--name-only", "--no-renames", mergeBase, "HEAD"])
        ),
    };
}

/** An open PR as `gh pr list --json` returns it, the fields the preflight reads. */
export interface OpenPr {
    number: number;
    title: string;
    labels: { name: string }[];
    files: { path: string }[];
    headRefName: string;
    author: { login: string };
    /** A fork's PR: never a merge-queue draft (`isMergifyQueuePr`). */
    isCrossRepository?: boolean;
}

/**
 * `gh pr list --json author` spells a GitHub App's login `app/mergify` (REST
 * says `mergify[bot]`, `MERGIFY_LOGIN`); normalised to the REST form so the
 * one predicate (`isMergifyQueuePr`) decides.
 */
export function restLogin(login: string): string {
    const m = /^app\/(.+)$/i.exec(login);
    return m === null ? login : `${m[1]}[bot]`;
}

/** Where an open PR stands relative to the merge queue. */
export type QueueState = "queued" | "draft" | "ready-to-land";

/**
 * A PR's queue state, or null when it is none of the three: Mergify's own
 * `queued` label, a Mergify merge-queue draft (its author and branch prefix,
 * `isMergifyQueuePr`), or the session's `ready-to-land` hand-off waiting for
 * the queue.
 */
export function queueState(pr: OpenPr): QueueState | null {
    const labels = pr.labels.map((l) => l.name);
    if (labels.includes(MERGIFY_QUEUED_LABEL)) return "queued";
    if (
        isMergifyQueuePr({
            author: restLogin(pr.author.login),
            headRef: pr.headRefName,
            headRepo: pr.isCrossRepository === true ? "fork" : "this",
            baseRepo: "this",
        })
    )
        return "draft";
    if (labels.includes(READY_LABEL)) return "ready-to-land";
    return null;
}

export interface OverlappingPr {
    number: number;
    title: string;
    state: QueueState;
    files: string[];
}

export interface CoupledHit {
    path: string;
    regenerate: string | null;
    /** Why it is coupled: the branch changed the path, or one of its inputs. */
    via: "path" | "inputs";
}

/** The four answers, plus what they were measured on. */
export interface DriftReport extends DriftMeasure {
    overlap: string[];
    coupled: CoupledHit[];
    prs: OverlappingPr[];
}

/** The coupled artefacts the base changed that this branch depends on. */
export function coupledHits(
    baseChanged: readonly string[],
    branchChanged: readonly string[]
): CoupledHit[] {
    const hits: CoupledHit[] = [];
    for (const a of COUPLED_ARTEFACTS) {
        if (!baseChanged.includes(a.path)) continue;
        if (branchChanged.includes(a.path))
            hits.push({ path: a.path, regenerate: a.regenerate, via: "path" });
        else if (
            a.inputs !== null &&
            branchChanged.some((p) => (a.inputs as RegExp).test(p))
        )
            hits.push({
                path: a.path,
                regenerate: a.regenerate,
                via: "inputs",
            });
    }
    return hits;
}

/** The open PRs in a queue state whose files meet this branch's. */
export function overlappingPrs(
    branchChanged: readonly string[],
    open: readonly OpenPr[],
    ownPr: number | null
): OverlappingPr[] {
    const mine = new Set(branchChanged);
    const out: OverlappingPr[] = [];
    for (const pr of open) {
        if (pr.number === ownPr) continue;
        const state = queueState(pr);
        if (state === null) continue;
        const files = pr.files.map((f) => f.path).filter((p) => mine.has(p));
        if (files.length > 0)
            out.push({ number: pr.number, title: pr.title, state, files });
    }
    return out.sort((a, b) => a.number - b.number);
}

/** Build the report: the measurement plus the three derived answers. */
export function buildReport(
    measure: DriftMeasure,
    open: readonly OpenPr[],
    ownPr: number | null
): DriftReport {
    const branch = new Set(measure.branchChanged);
    return {
        ...measure,
        overlap: measure.baseChanged.filter((p) => branch.has(p)).sort(),
        coupled: coupledHits(measure.baseChanged, measure.branchChanged),
        prs: overlappingPrs(measure.branchChanged, open, ownPr),
    };
}

/**
 * What the drift asks of the step that measured it:
 * - `current`: the base has not moved — verify, push, hand off.
 * - `rebase`: behind, nothing shared — rebase now (automatically where the
 *   caller can), then verify on the rebased tree.
 * - `refuse`: behind AND the base touched what this branch touches (a file
 *   both changed, or a coupled artefact owed a regeneration) — a rebase is a
 *   hand's work here: resolve, regenerate, re-verify; never an automatic one.
 *
 * An overlapping queued PR is a NOTE on every verdict: the base has not
 * absorbed it yet, so a rebase cannot resolve it — serializing same-area PRs
 * is a separate issue; the step says so and prefers waiting for it.
 */
export type DriftVerdict =
    | { kind: "current" }
    | { kind: "rebase" }
    | { kind: "refuse"; reasons: string[] };

export function driftVerdict(report: DriftReport): DriftVerdict {
    if (report.behind === 0) return { kind: "current" };
    const reasons: string[] = [];
    if (report.overlap.length > 0)
        reasons.push(
            `${report.overlap.length} file(s) changed on both sides: ${report.overlap.join(", ")}`
        );
    if (report.coupled.length > 0)
        reasons.push(
            `${report.coupled.length} coupled artefact(s) the base rewrote: ${report.coupled
                .map(
                    (c) =>
                        `${c.path} (${c.via === "path" ? "both changed it" : "this branch changed its inputs"}${
                            c.regenerate === null ? "" : `; \`${c.regenerate}\``
                        })`
                )
                .join(", ")}`
        );
    return reasons.length > 0
        ? { kind: "refuse", reasons }
        : { kind: "rebase" };
}

/** The distinct regeneration commands the coupled hits name, in order. */
export function regenerationCommands(coupled: readonly CoupledHit[]): string[] {
    return [
        ...new Set(
            coupled.flatMap((c) =>
                c.regenerate === null ? [] : [c.regenerate]
            )
        ),
    ];
}

function short(sha: string): string {
    return sha.slice(0, 10);
}

/** The four answers as `base:drift` prints them, one block. */
export function renderReport(
    report: DriftReport,
    verdict: DriftVerdict
): string {
    const out: string[] = [];
    out.push(
        `base:drift: ${report.branch} @ ${short(report.branchHead)} vs ${report.base} @ ${short(report.baseSha)} (merge-base ${short(report.mergeBase)})`
    );
    out.push(
        `  1. behind: ${report.behind} commit(s)${report.behind === 0 ? "" : ` — the base changed ${report.baseChanged.length} file(s)`}`
    );
    out.push(
        `  2. overlap (both changed): ${report.overlap.length === 0 ? "none" : report.overlap.join(", ")}`
    );
    out.push(
        `  3. coupled artefacts the base rewrote: ${
            report.coupled.length === 0
                ? "none"
                : report.coupled
                      .map(
                          (c) =>
                              `${c.path}${c.regenerate === null ? "" : ` → \`${c.regenerate}\``}`
                      )
                      .join(", ")
        }`
    );
    out.push(
        `  4. open PRs in the queue touching this branch's files: ${
            report.prs.length === 0
                ? "none"
                : report.prs
                      .map(
                          (p) =>
                              `PR #${p.number} [${p.state}] ${p.files.join(", ")}`
                      )
                      .join("; ")
        }`
    );
    switch (verdict.kind) {
        case "current":
            out.push(
                `  verdict: CURRENT — the base has not moved since the merge-base`
            );
            break;
        case "rebase":
            out.push(
                `  verdict: REBASE — behind with nothing shared: \`git fetch origin && git rebase ${report.base}\` first, verify after`
            );
            break;
        case "refuse":
            out.push(
                `  verdict: OVERLAP — behind and the base touched what this branch touches:`
            );
            for (const r of verdict.reasons) out.push(`    - ${r}`);
            out.push(
                `    rebase by hand, resolve, ${
                    regenerationCommands(report.coupled).length > 0
                        ? `run ${regenerationCommands(report.coupled)
                              .map((c) => `\`${c}\``)
                              .join(", ")}, `
                        : ""
                }re-verify on the rebased tree`
            );
            break;
    }
    if (report.prs.length > 0)
        out.push(
            `  NOTE: ${report.prs.length} queued PR(s) share files with this branch — the base has not absorbed them; prefer waiting for them to merge (serialization is a separate issue)`
        );
    return out.join("\n");
}

/** The receipt a later step reads: what was verified against what. */
export interface DriftReceipt {
    at: string;
    branch: string;
    branchHead: string;
    base: string;
    baseSha: string;
    mergeBase: string;
    behind: number;
    overlap: string[];
    coupled: string[];
    prs: number[];
    verdict: DriftVerdict["kind"];
}

/** The receipt's file name, under the worktree's own git dir. */
export const RECEIPT_FILE = "base-drift.json";

export function buildReceipt(
    report: DriftReport,
    verdict: DriftVerdict,
    now: Date
): DriftReceipt {
    return {
        at: now.toISOString(),
        branch: report.branch,
        branchHead: report.branchHead,
        base: report.base,
        baseSha: report.baseSha,
        mergeBase: report.mergeBase,
        behind: report.behind,
        overlap: report.overlap,
        coupled: report.coupled.map((c) => c.path),
        prs: report.prs.map((p) => p.number),
        verdict: verdict.kind,
    };
}

/** What `land:ready`'s step 0 needs beyond the measurement — a seam. */
export interface LandReadyPreflightDeps {
    /** Measure HEAD against the fetched base (`measureDrift`). */
    measure: () => DriftMeasure;
    /** The open PRs, for answer 4; [] when they could not be read. */
    openPrs: () => OpenPr[];
    /** `git rebase <base>`: `ok` when clean; else aborted, `why` = git's
     *  first error line. Throws when the abort itself failed (mid-rebase). */
    rebase: () => { ok: true } | { ok: false; why: string };
    /** Push the rebased HEAD over `expected` on the PR's branch (lease);
     *  throws with git's stderr when the push is rejected. */
    push: (expected: string) => void;
    /** HEAD after the rebase. */
    head: () => string;
    log: (line: string) => void;
}

/**
 * `land:ready`'s step 0 (issue #6647). Current → the head as it is. Behind
 * with nothing shared → rebase, push with a lease on the old head, return
 * the new head: the pre-queue steps then judge the rebased tree. Behind with
 * an overlap or a coupled artefact → refuse with the list and the
 * regeneration commands: a hand's rebase, never an automatic one on a tree
 * the base contradicts. Returns the report too, for the receipt.
 */
export function preflightLandReady(
    pr: number,
    deps: LandReadyPreflightDeps
): { head: string; report: DriftReport; verdict: DriftVerdict } {
    const measure = deps.measure();
    const report = buildReport(measure, deps.openPrs(), pr);
    const verdict = driftVerdict(report);
    deps.log(renderReport(report, verdict));
    if (verdict.kind === "current")
        return { head: measure.branchHead, report, verdict };
    if (verdict.kind === "refuse") {
        const regen = regenerationCommands(report.coupled);
        throw new Error(
            `PR #${pr} is ${report.behind} commit(s) behind ${report.base} and the base touched what it touches:\n` +
                verdict.reasons.map((r) => `  - ${r}`).join("\n") +
                `\n  \`git fetch origin && git rebase ${report.base}\`, resolve, ${
                    regen.length > 0
                        ? `run ${regen.map((c) => `\`${c}\``).join(", ")}, `
                        : ""
                }re-run the touched tests, push, re-run land:ready`
        );
    }
    deps.log(
        `land:ready: ${report.behind} commit(s) behind ${report.base}, nothing shared — rebasing before the pre-queue check`
    );
    const rebased = deps.rebase();
    if (!rebased.ok)
        throw new Error(
            `the automatic rebase onto ${report.base} failed and was aborted (${rebased.why}; the branch is back at ${short(measure.branchHead)}) — \`git fetch origin && git rebase ${report.base}\` by hand, resolve, push, re-run`
        );
    const head = deps.head();
    try {
        deps.push(measure.branchHead);
    } catch (err) {
        throw new Error(
            `rebased onto ${report.base} as ${short(head)} but the push was rejected (${(err as Error).message.split("\n")[0]}) — the rebased head is local only: \`git push --force-with-lease origin HEAD:${measure.branch}\`, then re-run land:ready`
        );
    }
    deps.log(
        `land:ready: rebased onto ${report.base} @ ${short(report.baseSha)} and pushed ${short(head)} — the pre-queue check judges this tree`
    );
    return { head, report, verdict };
}
