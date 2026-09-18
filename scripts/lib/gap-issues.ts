/**
 * `gaps:sync` — idempotent Grammar Gap / Bot Gap → issue filing (ADR 0137,
 * PRD issue #3820, issue #3829). PURE planning over an in-memory lockfile,
 * allowlist and Target registry: `gaps-sync.ts` does the I/O (the lockfile
 * read, the `gh`-backed tracker, the allowlist write-back).
 *
 * ── Scope of THIS module ────────────────────────────────────────────────
 *
 * Grammar Gaps here are the DERIVED OP CENSUS rows of `data/grammar-gaps.json`
 * (`check-gaps.ts`, ADR 0105 § 7.3) — the allowlist named in the issue body.
 * The census is bounded and shrink-only, so "one issue per gap" here is a
 * closed set, unlike the unbounded per-fragment backlog `oracle-report.ts
 * --gaps` prints (that one is `/new-set` v2's backlog, ADR 0137, not this
 * command's — filing an issue per fragment span on every `land` would flood
 * the tracker). An Op-census key shares `rankGrammarGaps`'s key space
 * (`opGapKey`, `grammar-gaps.ts`), so the corpus and per-Target counts below
 * are read straight off the SAME ranked backlog — no separate computation.
 *
 * Bot Gaps: no sweep exists yet (ADR 0105 § 7.2's Bot-play census is not
 * built — ADR 0137 "Bot reachability is computed, not walked" describes it,
 * `git grep` turns up no implementation as of this issue). `botGapFilings`
 * is wired to the same `GapTracker`/`syncGaps` machinery and returns nothing
 * until that sweep lands; the issue body's "once the sweep exists" is this.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Every allowlist row is seeded pointing at PRD issue #3820 (`PRD_ISSUE`)
 * until `gaps:sync` files its own — that placeholder IS the "unfiled" state,
 * not a magic sentinel invented here (`data/grammar-gaps.json`'s own `note`).
 * A row whose `issue` differs is "already filed": the tracker is asked for
 * that issue's live state — CLOSED is left alone (a gap closes through its
 * PR, never through disappearing from the allowlist, ADR 0137), OPEN gets
 * its body refreshed only when the computed body actually changed, so a
 * second run against unchanged inputs performs no writes at all.
 */

import type { Allowlist } from "../check-gaps";
import { rankGrammarGaps, type GapCounts } from "./grammar-gaps";
import type { Lockfile } from "./oracle-lockfile";
import {
    resolveTarget,
    type ResolveContext,
    type TargetKind,
    type TargetRegistry,
} from "./targets";

/** The PRD umbrella every allowlist row is seeded pointing at — also the
 *  fallback parent for any gap that no priority Target of kind `set` ranks. */
export const PRD_ISSUE = 3820;

export const GRAMMAR_GAP_LABELS = [
    "ready-for-agent",
    "area:mechanics",
] as const;
export const BOT_GAP_LABELS = ["ready-for-agent", "area:game-bot"] as const;

/** One priority Target's leverage for a single gap key — only Targets that
 *  actually rank the gap (`refuses > 0`) appear. */
export interface TargetGapCount {
    readonly targetId: string;
    readonly kind: TargetKind;
    readonly compiles: number;
    readonly refuses: number;
}

export interface GrammarGapFiling {
    readonly key: string;
    readonly op: string;
    /** The allowlist row's CURRENT `issue` — `PRD_ISSUE` means unfiled. */
    readonly currentIssue: number;
    readonly filed: boolean;
    readonly corpus: GapCounts;
    /** Priority Targets that rank this gap, in priority order. */
    readonly perTarget: readonly TargetGapCount[];
    /** The highest-priority Target that ranks this gap, or null. */
    readonly topTarget: TargetGapCount | null;
    /** The set code (`APC`, …) when `topTarget.kind === "set"`, else null. */
    readonly topTargetSetCode: string | null;
    readonly title: string;
    readonly body: string;
}

function targetSetCode(source: string): string | null {
    const m = /([^/]+)\.json$/i.exec(source);
    return m === null ? null : m[1]!.toUpperCase();
}

export function grammarGapTitle(key: string): string {
    return `Grammar Gap: ${key}`;
}

function formatTargetLine(t: TargetGapCount): string {
    return `- ${t.targetId} (${t.kind}): refuses ${t.refuses}, compiles ${t.compiles}`;
}

export function renderGrammarGapBody(
    op: string,
    key: string,
    corpus: GapCounts,
    perTarget: readonly TargetGapCount[]
): string {
    return [
        `Op census gap (ADR 0105 § 7.3, ADR 0137): \`${op}\` is \`implemented\` in the Mechanics Registry, but no Compiled Definition emits it.`,
        "",
        `Corpus: ${corpus.refuses} unparsed card(s) attributed to this gap, ${corpus.compiles} of which would compile the day the rule lands (it is their only remaining gap).`,
        "",
        perTarget.length === 0
            ? "No registered Target List (`data/targets.json`) currently ranks this gap."
            : `Cards unlocked per Target, priority order:\n${perTarget.map(formatTargetLine).join("\n")}`,
        "",
        `Land the grammar rule that emits \`${op}\`, or retire the Op — the allowlist only shrinks (\`data/grammar-gaps.json\`, key \`${key}\`).`,
    ].join("\n");
}

/**
 * One `GrammarGapFiling` per allowlist row, corpus and per-Target counts read
 * straight off `rankGrammarGaps` (shared key space, module header). Only
 * Targets carrying a `priority` rank — `targets.ts`: "A Target with no
 * priority is measured, not ranked by."
 */
export function buildGrammarGapFilings(
    lock: Pick<Lockfile, "cards" | "fragments">,
    allowlist: Allowlist,
    registry: TargetRegistry,
    ctx: ResolveContext
): GrammarGapFiling[] {
    const corpusByKey = new Map(
        rankGrammarGaps(lock, null).map((g) => [g.key, g.corpus] as const)
    );

    const priorityTargets = registry.targets
        .filter((t) => t.priority !== undefined)
        .slice()
        .sort((a, b) => a.priority! - b.priority!)
        .map((row) => {
            const resolved = resolveTarget(row, ctx);
            const ids = new Set(resolved.cards.map((c) => c.oracleId));
            return {
                row,
                byKey: new Map(
                    rankGrammarGaps(lock, ids).map(
                        (g) => [g.key, g.target] as const
                    )
                ),
            };
        });

    return allowlist.ops.map((opRow) => {
        const key = opRow.key;
        const corpus = corpusByKey.get(key) ?? { refuses: 0, compiles: 0 };
        const perTarget: TargetGapCount[] = [];
        let topTarget: TargetGapCount | null = null;
        let topTargetSetCode: string | null = null;
        for (const { row, byKey } of priorityTargets) {
            const counts = byKey.get(key);
            if (counts === undefined) continue;
            const entry: TargetGapCount = {
                targetId: row.id,
                kind: row.kind,
                compiles: counts.compiles,
                refuses: counts.refuses,
            };
            perTarget.push(entry);
            if (topTarget === null) {
                topTarget = entry;
                topTargetSetCode =
                    row.kind === "set" ? targetSetCode(row.source) : null;
            }
        }
        const filed = opRow.issue !== PRD_ISSUE;
        return {
            key,
            op: opRow.op,
            currentIssue: opRow.issue,
            filed,
            corpus,
            perTarget,
            topTarget,
            topTargetSetCode,
            title: grammarGapTitle(key),
            body: renderGrammarGapBody(opRow.op, key, corpus, perTarget),
        };
    });
}

/**
 * The Bot Gap sweep does not exist yet (module header). Returns nothing
 * until it does; kept as its own function so `gaps-sync.ts` and its tests
 * already wire the second kind ADR 0137 names.
 */
export function buildBotGapFilings(): GrammarGapFiling[] {
    return [];
}

// ── Tracker ──────────────────────────────────────────────────────────────

export interface TrackedIssue {
    readonly state: "OPEN" | "CLOSED";
    readonly body: string;
}

export interface GapTracker {
    /** null when the issue does not exist (or cannot be read). */
    getIssue(number: number): TrackedIssue | null;
    createIssue(input: {
        title: string;
        body: string;
        labels: readonly string[];
        parent: number;
    }): number;
    updateBody(number: number, body: string): void;
    /** The open, `prd`-labelled `[<CODE>] … set rollout` issue, or null. */
    findSetUmbrella(setCode: string): number | null;
}

export type GapSyncAction =
    | { readonly kind: "create"; readonly key: string; readonly issue: number }
    | { readonly kind: "update"; readonly key: string; readonly issue: number }
    | { readonly kind: "noop"; readonly key: string; readonly issue: number }
    | {
          readonly kind: "skip-closed";
          readonly key: string;
          readonly issue: number;
      };

export interface GapSyncResult {
    readonly actions: readonly GapSyncAction[];
    /** Keys whose allowlist row must be updated to this new `issue` number. */
    readonly updatedRows: ReadonlyMap<string, number>;
}

/** The parent to file/reconcile `filing` under (issue body: "parent = the
 *  current set umbrella when the gap was ranked for a set, else PRD #3820"). */
function parentOf(filing: GrammarGapFiling, tracker: GapTracker): number {
    if (filing.topTargetSetCode === null) return PRD_ISSUE;
    return tracker.findSetUmbrella(filing.topTargetSetCode) ?? PRD_ISSUE;
}

/**
 * Create, update or leave alone — one decision per filing, entirely through
 * `tracker` so a stub can prove create / update / idempotent-noop / a closed
 * issue staying closed without touching a real tracker.
 */
export function syncGaps(
    filings: readonly GrammarGapFiling[],
    tracker: GapTracker,
    labels: readonly string[]
): GapSyncResult {
    const actions: GapSyncAction[] = [];
    const updatedRows = new Map<string, number>();

    for (const filing of filings) {
        if (!filing.filed) {
            const issue = tracker.createIssue({
                title: filing.title,
                body: filing.body,
                labels,
                parent: parentOf(filing, tracker),
            });
            updatedRows.set(filing.key, issue);
            actions.push({ kind: "create", key: filing.key, issue });
            continue;
        }

        const existing = tracker.getIssue(filing.currentIssue);
        if (existing === null) {
            const issue = tracker.createIssue({
                title: filing.title,
                body: filing.body,
                labels,
                parent: parentOf(filing, tracker),
            });
            updatedRows.set(filing.key, issue);
            actions.push({ kind: "create", key: filing.key, issue });
            continue;
        }
        if (existing.state === "CLOSED") {
            actions.push({
                kind: "skip-closed",
                key: filing.key,
                issue: filing.currentIssue,
            });
            continue;
        }
        if (existing.body === filing.body) {
            actions.push({
                kind: "noop",
                key: filing.key,
                issue: filing.currentIssue,
            });
            continue;
        }
        tracker.updateBody(filing.currentIssue, filing.body);
        actions.push({
            kind: "update",
            key: filing.key,
            issue: filing.currentIssue,
        });
    }

    return { actions, updatedRows };
}

/** Apply a sync's `updatedRows` onto the allowlist — the write-back the
 *  issue body asks for. A no-op input returns the SAME object (reference
 *  equality), so a caller can skip writing the file when nothing changed. */
export function applyUpdatedIssues(
    allowlist: Allowlist,
    updatedRows: ReadonlyMap<string, number>
): Allowlist {
    if (updatedRows.size === 0) return allowlist;
    return {
        ...allowlist,
        ops: allowlist.ops.map((row) => {
            const next = updatedRows.get(row.key);
            return next === undefined || next === row.issue
                ? row
                : { ...row, issue: next };
        }),
    };
}
