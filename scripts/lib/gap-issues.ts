/**
 * `gaps:sync` — the ONE filer of every computed Gap (ADR 0137, PRD issue
 * #3820, issues #3829, #3974 and #3869). PURE planning: `gaps-sync.ts` does
 * the I/O (the `gh`-backed tracker, the write-back).
 *
 * This module holds the SHAPE of a filing, the tracker seam and the sync
 * decision; the four COMPUTED kinds live in `gap-kinds.ts`. `grammar` is here,
 * because it is the one kind whose issue number is written back into an `ops`
 * row rather than into `claims`, and `bot` because it files nothing yet.
 *
 * ── Scope of the `grammar` kind ─────────────────────────────────────────
 *
 * Grammar Gaps here are the DERIVED OP CENSUS rows of `data/grammar-gaps.json`
 * (`check-gaps.ts`, ADR 0105 § 7.3): bounded and shrink-only, so "one issue
 * per gap" is a closed set. The per-fragment backlog `oracle:report --gaps`
 * ranks per Target is a different, unbounded list — not this command's.
 *
 * An Op-census gap carries NO corpus or per-Target count. The key FORMAT is
 * shared with `rankGrammarGaps` (`opGapKey`), but the compiler attributes a
 * refused line to the slot that got furthest — never to an Op — so no
 * Fragment ever lands on an `(op) › …` key (0 of ~34k in the lockfile the day
 * this was measured, issue #3974). The first version read those counts anyway
 * and filed 87 bodies all saying "0 cards, no Target"; the body says what the
 * gap is instead of printing a number that is zero by construction. **The
 * other four kinds are counted per Target for real** — their keys come from
 * quarantine reasons, card names and slot signatures, which every Target
 * card's own lockfile row carries.
 *
 * Bot Gaps: no Bot-play sweep exists yet (ADR 0105 § 7.2), so
 * `buildBotGapFilings` returns nothing until it does.
 *
 * ── Parent, and the cap ────────────────────────────────────────────────
 *
 * Every Op-gap issue is a child of `OP_GAP_UMBRELLA`, never of PRD #3820
 * directly: GitHub caps a parent at 100 sub-issues, and 87 Op gaps under the
 * PRD filled it, leaving no room for its own slices (issue #3974). The other
 * kinds parent under their Target's set umbrella when there is one, else PRD
 * #3820. `syncGaps` refuses up front, before any write, a run whose creates
 * would push ANY parent past the cap — per parent, since a run now spans
 * several.
 *
 * ── Idempotency ────────────────────────────────────────────────────────
 *
 * Every allowlist `ops` row was seeded pointing at PRD issue #3820
 * (`PRD_ISSUE`) until `gaps:sync` filed its own — that placeholder IS the
 * "unfiled" state (`data/grammar-gaps.json`'s own `note`). Every other kind is
 * unfiled while no `claims` row carries its `(kind, key)`. A filed gap's issue
 * is read back: CLOSED is left alone (a gap closes through its PR, ADR 0137),
 * OPEN gets its body rewritten only when the computed body differs, so a
 * second run against unchanged inputs writes nothing.
 *
 * A body may name its own issue number (the `hand-tail` kind prints the marker
 * line the closing PR must add), which no caller can know before the issue
 * exists — so a filing's body is a FUNCTION of the issue number, and a create
 * is followed by one patch when the two differ. Every later run compares
 * `body(currentIssue)`, so that patch happens exactly once per issue.
 */

import type { Allowlist } from "../check-gaps";
import { claimId, splitClaimId, type ClaimRow, type GapKind } from "./targets";

/** The placeholder every allowlist row was seeded with: "not filed yet". */
export const PRD_ISSUE = 3820;

/** The parent of every Op-gap issue (itself a child of PRD #3820). */
export const OP_GAP_UMBRELLA = 3972;

/** GitHub's hard cap on sub-issues per parent. */
export const SUB_ISSUE_CAP = 100;

/** Labels per kind, the issue #3869 table — `ready-for-agent` on every one,
 *  because a computed gap is work an agent can pick up as filed. */
export const GAP_LABELS: Readonly<Record<GapKind, readonly string[]>> = {
    grammar: ["ready-for-agent", "area:mechanics"],
    mechanic: ["ready-for-agent", "area:mechanics"],
    scenario: ["ready-for-agent", "area:mechanics"],
    bot: ["ready-for-agent", "area:game-bot"],
    "hand-tail": ["ready-for-agent", "area:cards", "hand-tail"],
    migration: ["ready-for-agent", "area:cards", "migration"],
};

export const GRAMMAR_GAP_LABELS = GAP_LABELS.grammar;

/**
 * The title prefix of each kind — the search term `GhGapTracker` prefetches a
 * kind's filed issues by, and the reason two kinds never share a title shape.
 */
export const GAP_TITLE_PREFIX: Readonly<Record<GapKind, string>> = {
    grammar: "Grammar Gap:",
    mechanic: "Quarantine (mechanic):",
    scenario: "Quarantine (scenario):",
    bot: "Bot Gap:",
    "hand-tail": "Hand Tail:",
    migration: "Migration:",
};

/**
 * One issue `gaps:sync` will create or reconcile.
 *
 * `currentIssue` is `null` exactly when nothing has been filed for this
 * `(kind, key)` yet. `body` takes the issue's own number so a body may quote
 * it (module header).
 */
export interface GapFiling {
    readonly kind: GapKind;
    /** Stable within the kind — the key schemes are `GAP_KINDS`'s doc. */
    readonly key: string;
    readonly currentIssue: number | null;
    readonly title: string;
    readonly labels: readonly string[];
    /** The set code whose umbrella should parent this issue, or null. */
    readonly parentSetCode: string | null;
    /** The parent to use when `parentSetCode` names no live umbrella. */
    readonly fallbackParent: number;
    readonly body: (issue: number) => string;
}

export function grammarGapTitle(key: string): string {
    return `${GAP_TITLE_PREFIX.grammar} ${key}`;
}

export function renderOpGapBody(op: string, key: string): string {
    return [
        `Op census gap (ADR 0105 § 7.3, ADR 0137): \`${op}\` is \`implemented\` in the Mechanics Registry, but no Compiled Definition emits it.`,
        "",
        `The work is the Grammar Rule that emits \`${op}\` — find the Oracle clause forms the hand-written cards using \`${op}\` express, and teach a slot or shared sub-grammar to lower them to it, with golden fixtures per form. Or retire the Op, if nothing should emit it.`,
        "",
        `No card count here: the compiler attributes a refused line to the slot that got furthest, never to an Op, so an Op gap has no corpus or per-Target figure of its own. Which clause forms matter most is \`bun run oracle:report --gaps\`'s question.`,
        "",
        `Closes when the rule lands: \`bun run check:gaps\` then forces the allowlist row (\`data/grammar-gaps.json\`, key \`${key}\`) out — the allowlist only shrinks.`,
        "",
        `Parent: #${OP_GAP_UMBRELLA} (Op census gaps umbrella).`,
    ].join("\n");
}

/** One filing per allowlist row. */
export function buildGrammarGapFilings(allowlist: Allowlist): GapFiling[] {
    return allowlist.ops.map((row) => {
        const body = renderOpGapBody(row.op, row.key);
        return {
            kind: "grammar" as const,
            key: row.key,
            currentIssue: row.issue === PRD_ISSUE ? null : row.issue,
            title: grammarGapTitle(row.key),
            labels: GAP_LABELS.grammar,
            parentSetCode: null,
            fallbackParent: OP_GAP_UMBRELLA,
            body: () => body,
        };
    });
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

/** One open issue of the tracker, as the orphan-card pass reads it. */
export interface TrackedIssueSummary {
    readonly number: number;
    readonly title: string;
    readonly labels: readonly string[];
}

export interface GapTracker {
    /** null when the issue does not exist. Anything else THROWS: read as null
     *  a transient failure would file a duplicate and orphan the real issue
     *  (issue #3974). */
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
    /** The open, `prd`-labelled `[<CODE>] … set rollout` issue, or null. */
    findSetUmbrella(setCode: string): number | null;
    /** Every OPEN issue carrying `label`. */
    listOpen(label: string): readonly TrackedIssueSummary[];
    addLabel(number: number, label: string): void;
    comment(number: number, body: string): void;
}

export type GapSyncAction = {
    readonly action: "create" | "update" | "noop" | "skip-closed";
    readonly kind: GapKind;
    readonly key: string;
    readonly issue: number;
};

export interface GapSyncResult {
    readonly actions: readonly GapSyncAction[];
    /** `claimId(kind, key)` → the issue number the allowlist must record. */
    readonly updatedRows: ReadonlyMap<string, number>;
}

/** The parent to file `filing` under — its Target's umbrella, else the kind's
 *  own fallback (`OP_GAP_UMBRELLA` for `grammar`, PRD #3820 otherwise). */
function parentOf(filing: GapFiling, tracker: GapTracker): number {
    if (filing.parentSetCode === null) return filing.fallbackParent;
    return (
        tracker.findSetUmbrella(filing.parentSetCode) ?? filing.fallbackParent
    );
}

/**
 * Create, update or leave alone — one decision per filing, entirely through
 * `tracker`. Reads every filed issue first and refuses, before any write, a
 * run whose creates would push ANY parent past GitHub's sub-issue cap: an
 * issue created and then left unparented is the failure this guards (issue
 * #3974), and a run now spans several parents, so the count is per parent.
 */
export function syncGaps(
    filings: readonly GapFiling[],
    tracker: GapTracker
): GapSyncResult {
    const existing = new Map<string, TrackedIssue | null>();
    for (const filing of filings) {
        if (filing.currentIssue !== null) {
            existing.set(
                claimId(filing.kind, filing.key),
                tracker.getIssue(filing.currentIssue)
            );
        }
    }
    const isCreate = (filing: GapFiling): boolean =>
        filing.currentIssue === null ||
        existing.get(claimId(filing.kind, filing.key)) === null;

    // Resolve each create's parent ONCE — `findSetUmbrella` is a network call
    // and the cap check and the create itself must agree on the answer.
    const parents = new Map<string, number>();
    const creates = new Map<number, number>();
    for (const filing of filings) {
        if (!isCreate(filing)) continue;
        const parent = parentOf(filing, tracker);
        parents.set(claimId(filing.kind, filing.key), parent);
        creates.set(parent, (creates.get(parent) ?? 0) + 1);
    }
    for (const [parent, n] of creates) {
        const children = tracker.subIssueCount(parent);
        if (children + n > SUB_ISSUE_CAP) {
            throw new Error(
                `gaps:sync: issue #${parent} holds ${children} sub-issues; ${n} more would pass GitHub's cap of ${SUB_ISSUE_CAP} — nothing was filed`
            );
        }
    }

    const actions: GapSyncAction[] = [];
    const updatedRows = new Map<string, number>();
    for (const filing of filings) {
        const id = claimId(filing.kind, filing.key);
        const common = { kind: filing.kind, key: filing.key };
        if (isCreate(filing)) {
            const issue = tracker.createIssue({
                title: filing.title,
                body: filing.body(0),
                labels: filing.labels,
                parent: parents.get(id)!,
            });
            // The body may quote the issue's own number, which only exists now.
            const settled = filing.body(issue);
            if (settled !== filing.body(0)) tracker.updateBody(issue, settled);
            updatedRows.set(id, issue);
            actions.push({ action: "create", ...common, issue });
            continue;
        }
        const issue = filing.currentIssue!;
        const current = existing.get(id)!;
        if (current.state === "CLOSED") {
            actions.push({ action: "skip-closed", ...common, issue });
            continue;
        }
        const body = filing.body(issue);
        if (current.body === body) {
            actions.push({ action: "noop", ...common, issue });
            continue;
        }
        tracker.updateBody(issue, body);
        actions.push({ action: "update", ...common, issue });
    }
    return { actions, updatedRows };
}

/**
 * Apply a sync's `updatedRows` onto the allowlist document. A `grammar` row's
 * number goes on its `ops` row (the census's own shape, issue #3824); every
 * other kind takes a `claims` row. The shrink-only `ops` MEMBERSHIP
 * `check:gaps` guards is never touched — only an existing row's `issue`.
 *
 * Existing `claims` rows are KEPT, never pruned: a quarantine class that stops
 * appearing has an issue that is still open, and dropping its row would
 * re-file the same issue the day the class comes back. `gaps-sync.ts` reports
 * such a row instead, so a stale issue is visible rather than silent. Rows are
 * re-sorted by kind then key so two runs over one tree write one file.
 *
 * A no-op input returns the SAME object (reference equality), so a caller can
 * skip writing the file when nothing changed.
 */
export function applyUpdatedIssues(
    allowlist: Allowlist,
    updatedRows: ReadonlyMap<string, number>
): Allowlist {
    if (updatedRows.size === 0) return allowlist;
    const ops = allowlist.ops.map((row) => {
        const next = updatedRows.get(claimId("grammar", row.key));
        return next === undefined || next === row.issue
            ? row
            : { ...row, issue: next };
    });
    const claims = new Map<string, ClaimRow>(
        (allowlist.claims ?? []).map(
            (row) => [claimId(row.kind, row.key), row] as const
        )
    );
    for (const [id, issue] of updatedRows) {
        const { kind, key } = splitClaimId(id);
        if (kind === "grammar") continue;
        claims.set(id, { kind, key, issue });
    }
    const sorted = [...claims.values()].sort((a, b) =>
        a.kind !== b.kind
            ? a.kind < b.kind
                ? -1
                : 1
            : a.key < b.key
              ? -1
              : a.key > b.key
                ? 1
                : 0
    );
    return sorted.length === 0
        ? { ...allowlist, ops }
        : { ...allowlist, ops, claims: sorted };
}
