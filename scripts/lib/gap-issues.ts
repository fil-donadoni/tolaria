/**
 * `gaps:sync` — idempotent Grammar Gap / Bot Gap → issue filing (ADR 0137,
 * PRD issue #3820, issue #3829). PURE planning over the allowlist:
 * `gaps-sync.ts` does the I/O (the `gh`-backed tracker, the write-back).
 *
 * ── Scope ──────────────────────────────────────────────────────────────
 *
 * Grammar Gaps here are the DERIVED OP CENSUS rows of `data/grammar-gaps.json`
 * (`check-gaps.ts`, ADR 0105 § 7.3): bounded and shrink-only, so "one issue
 * per gap" is a closed set. The per-fragment backlog `oracle:report --gaps`
 * ranks per Target, and the other Gap kinds, are issue #3869's.
 *
 * An Op-census gap carries NO corpus or per-Target count. The key FORMAT is
 * shared with `rankGrammarGaps` (`opGapKey`), but the compiler attributes a
 * refused line to the slot that got furthest — never to an Op — so no
 * Fragment ever lands on an `(op) › …` key (0 of ~34k in the lockfile the day
 * this was measured). The first version read those counts anyway and filed
 * 87 bodies all saying "0 cards, no Target"; the body now says what the gap
 * is instead of printing a number that is zero by construction.
 *
 * Bot Gaps: no Bot-play sweep exists yet (ADR 0105 § 7.2), so
 * `buildBotGapFilings` returns nothing until it does.
 *
 * ── Parent ─────────────────────────────────────────────────────────────
 *
 * Every Op-gap issue is a child of `OP_GAP_UMBRELLA`, never of PRD #3820
 * directly: GitHub caps a parent at 100 sub-issues, and 87 Op gaps under the
 * PRD filled it, leaving no room for its own slices. The census only shrinks,
 * so the umbrella never outgrows its first 87 — and `syncGaps` refuses up
 * front, before any write, a run whose creates would exceed the cap anyway.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Every allowlist row was seeded pointing at PRD issue #3820 (`PRD_ISSUE`)
 * until `gaps:sync` files its own — that placeholder IS the "unfiled" state
 * (`data/grammar-gaps.json`'s own `note`). A filed row's issue is read back:
 * CLOSED is left alone (a gap closes through its PR, ADR 0137), OPEN gets its
 * body rewritten only when the computed body differs, so a second run against
 * unchanged inputs writes nothing.
 */

import type { Allowlist } from "../check-gaps";

/** The placeholder every allowlist row was seeded with: "not filed yet". */
export const PRD_ISSUE = 3820;

/** The parent of every Op-gap issue (itself a child of PRD #3820). */
export const OP_GAP_UMBRELLA = 3972;

/** GitHub's hard cap on sub-issues per parent. */
export const SUB_ISSUE_CAP = 100;

export const GRAMMAR_GAP_LABELS = [
    "ready-for-agent",
    "area:mechanics",
] as const;
export const BOT_GAP_LABELS = ["ready-for-agent", "area:game-bot"] as const;

export interface GapFiling {
    readonly key: string;
    /** The allowlist row's CURRENT `issue` — `PRD_ISSUE` means unfiled. */
    readonly currentIssue: number;
    readonly filed: boolean;
    readonly title: string;
    readonly body: string;
}

export function grammarGapTitle(key: string): string {
    return `Grammar Gap: ${key}`;
}

export function renderOpGapBody(op: string, key: string): string {
    return [
        `Op census gap (ADR 0105 § 7.3, ADR 0137): \`${op}\` is \`implemented\` in the Mechanics Registry, but no Compiled Definition emits it.`,
        "",
        `The work is the Grammar Rule that emits \`${op}\` — find the Oracle clause forms the hand-written cards using \`${op}\` express, and teach a slot or shared sub-grammar to lower them to it, with golden fixtures per form. Or retire the Op, if nothing should emit it.`,
        "",
        `No card count here: the compiler attributes a refused line to the slot that got furthest, never to an Op, so an Op gap has no corpus or per-Target figure of its own. Which clause forms matter most is \`bun run oracle:report --gaps\`'s question.`,
        "",
        `Closes when the rule lands: \`check:gaps\` then forces the allowlist row (\`data/grammar-gaps.json\`, key \`${key}\`) out — the allowlist only shrinks.`,
    ].join("\n");
}

/** One filing per allowlist row. */
export function buildGrammarGapFilings(allowlist: Allowlist): GapFiling[] {
    return allowlist.ops.map((row) => ({
        key: row.key,
        currentIssue: row.issue,
        filed: row.issue !== PRD_ISSUE,
        title: grammarGapTitle(row.key),
        body: renderOpGapBody(row.op, row.key),
    }));
}

/** The Bot Gap sweep does not exist yet (module header). */
export function buildBotGapFilings(): GapFiling[] {
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
    /** How many sub-issues `parent` holds right now. */
    subIssueCount(parent: number): number;
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

/**
 * Create, update or leave alone — one decision per filing, entirely through
 * `tracker`. Reads every filed issue first and refuses, before any write, a
 * run whose creates would push `parent` past GitHub's sub-issue cap: an issue
 * created and then left unparented is the failure this guards.
 */
export function syncGaps(
    filings: readonly GapFiling[],
    tracker: GapTracker,
    labels: readonly string[],
    parent: number
): GapSyncResult {
    const existing = new Map<string, TrackedIssue | null>();
    for (const f of filings) {
        if (f.filed) existing.set(f.key, tracker.getIssue(f.currentIssue));
    }
    const creates = filings.filter(
        (f) => !f.filed || existing.get(f.key) === null
    ).length;
    if (creates > 0) {
        const children = tracker.subIssueCount(parent);
        if (children + creates > SUB_ISSUE_CAP) {
            throw new Error(
                `gaps:sync: issue #${parent} holds ${children} sub-issues; ${creates} more would pass GitHub's cap of ${SUB_ISSUE_CAP} — nothing was filed`
            );
        }
    }

    const actions: GapSyncAction[] = [];
    const updatedRows = new Map<string, number>();
    for (const filing of filings) {
        const current = filing.filed ? existing.get(filing.key)! : null;
        if (current === null) {
            const issue = tracker.createIssue({
                title: filing.title,
                body: filing.body,
                labels,
                parent,
            });
            updatedRows.set(filing.key, issue);
            actions.push({ kind: "create", key: filing.key, issue });
            continue;
        }
        const issue = filing.currentIssue;
        if (current.state === "CLOSED") {
            actions.push({ kind: "skip-closed", key: filing.key, issue });
        } else if (current.body === filing.body) {
            actions.push({ kind: "noop", key: filing.key, issue });
        } else {
            tracker.updateBody(issue, filing.body);
            actions.push({ kind: "update", key: filing.key, issue });
        }
    }
    return { actions, updatedRows };
}

/** Apply a sync's `updatedRows` onto the allowlist. A no-op input returns
 *  the SAME object, so a caller can skip writing the file. */
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
