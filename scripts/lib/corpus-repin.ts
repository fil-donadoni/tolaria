// The weekly corpus re-pin's decisions (issue #6387).
//
// A re-pin moves the Card Corpus pin to Scryfall's current `oracle_cards`
// bulk and regenerates everything downstream. Three things then block the
// merge, and before this job a person settled each by hand (issue #6367):
//
//   - a card that LEFT `ready` — `check:oracle` refuses it unacknowledged;
//   - an unclaimed card of an ENFORCED Target — `check:targets` refuses it;
//   - a retired lockfile row the new Oracle text moved — `land` refuses it
//     unless the PR body names it under `## Retired rows`.
//
// The owner chose to settle all three automatically: a card that left the
// corpus is a deliberate drop (`intended`); every other loss and every missing
// claim goes to ONE roll-up issue per run, filed for triage into Grammar
// Clusters; a moved retired row is named with the fields the compiler
// re-derived. This module is that policy, pure — rows, regressions and
// coverage in; ledger entries, claim rows and markdown out — so every branch
// is testable without git, `gh`, Scryfall or a 25 MB corpus.

import type { CardRow } from "./oracle-lockfile";
import type {
    ReadyRegression,
    RegressionAcknowledgement,
} from "./oracle-state-regressions";
import type { ChangedRetiredRow } from "./retirement-ack";
import { claimId, type MissingClaim } from "./targets";

/** Every re-pin PR's branch starts with this; an open PR on one stops the
 *  next run (two re-pins in flight would conflict on every generated file). */
export const REPIN_BRANCH_PREFIX = "chore/corpus-repin-";

/** `2026-10-22T09:01:54.353+00:00` → `2026-10-22`: the corpus DATE, Scryfall's
 *  own `updated_at`, which names the branch, the issue and every reason. */
export function corpusDate(updatedAt: string): string {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(updatedAt);
    if (m === null)
        throw new Error(`corpus updatedAt "${updatedAt}" is not a date`);
    return m[1]!;
}

export function repinBranch(date: string): string {
    return `${REPIN_BRANCH_PREFIX}${date}`;
}

/** An unclaimed card of an enforced Target, as `targetCoverage` reports it. */
export interface UnclaimedCard {
    readonly target: string;
    readonly name: string;
    readonly why: string;
    readonly missing?: MissingClaim;
}

/** A `ready` loss the corpus did not cause by dropping the card — the ones
 *  the roll-up issue tracks. */
export function trackedLosses(
    regressions: readonly ReadyRegression[]
): ReadyRegression[] {
    return regressions.filter((r) => r.to !== "absent");
}

/** Does this run owe a roll-up issue? Only when something must point at one. */
export function needsRollup(
    regressions: readonly ReadyRegression[],
    unclaimed: readonly UnclaimedCard[]
): boolean {
    return trackedLosses(regressions).length > 0 || unclaimed.length > 0;
}

/**
 * The ledger entries that let this re-pin shrink the pool. A card absent from
 * the new lockfile left Scryfall's bulk (the 2026-10 drop of Alchemy `A-` rows
 * is the precedent) — `intended`; any other loss is the new Oracle text the
 * grammar does not read yet — `trackedBy` the roll-up.
 */
export function planAcknowledgements(
    regressions: readonly ReadyRegression[],
    rollup: number | null,
    date: string
): RegressionAcknowledgement[] {
    return regressions.map((r) => {
        if (r.to === "absent")
            return {
                oracleId: r.oracleId,
                name: r.name,
                reason: `left Scryfall's oracle_cards bulk at the ${date} corpus re-pin: the card left the corpus, not the grammar`,
                intended: true,
            };
        if (rollup === null)
            throw new Error(
                `${r.name} left \`ready\` (→ ${r.to}) and no roll-up issue was filed to track it`
            );
        return {
            oracleId: r.oracleId,
            name: r.name,
            reason: `left \`ready\` (→ ${r.to}) at the ${date} corpus re-pin: its new Oracle text is not read by the grammar yet; triaged in the roll-up`,
            trackedBy: rollup,
        };
    });
}

/**
 * The claim rows that settle the enforced Targets' unclaimed cards, keyed
 * `claimId → issue` (the shape `applyUpdatedIssues` takes), and the cards no
 * single claim can settle — those fail the run, since an automated writer has
 * no claim to invent for them.
 */
export function planClaims(
    unclaimed: readonly UnclaimedCard[],
    rollup: number
): { rows: Map<string, number>; unsettled: UnclaimedCard[] } {
    const rows = new Map<string, number>();
    const unsettled: UnclaimedCard[] = [];
    for (const card of unclaimed) {
        if (card.missing === undefined) unsettled.push(card);
        else rows.set(claimId(card.missing.kind, card.missing.key), rollup);
    }
    return { rows, unsettled };
}

/** The keys whose values differ between two objects, sorted. */
function changedKeys(
    before: Readonly<Record<string, unknown>>,
    after: Readonly<Record<string, unknown>>
): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
        .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        .sort();
}

/** Which fields of a lockfile row moved: `definition.*` keys by name, the
 *  row's own keys beside them. */
export function rowFieldChanges(before: CardRow, after: CardRow): string[] {
    const own = changedKeys(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>
    ).filter((k) => k !== "definition");
    const def = changedKeys(
        (before.definition ?? {}) as Record<string, unknown>,
        (after.definition ?? {}) as Record<string, unknown>
    ).map((k) => `definition.${k}`);
    return [...def, ...own];
}

/**
 * One `## Retired rows` line per retired row the re-pin moved — the card's
 * exact name first, as `land`'s `acknowledgedNames` reads it. A row that is
 * still `ready` was re-derived by the compiler from the new Oracle text, and
 * `check:oracle` re-proves it is the compiler's reading of the current card;
 * a row that left the file left the corpus. A row that LOST its marker is not
 * a re-pin's doing (the corpus carries no markers) and is refused.
 */
export function retiredRowLines(
    changed: readonly ChangedRetiredRow[],
    before: ReadonlyMap<string, CardRow>,
    after: ReadonlyMap<string, CardRow>,
    date: string
): string[] {
    return changed.map((row) => {
        if (row.change === "row-removed")
            return `- ${row.name} — the row left the lockfile: the card left Scryfall's oracle_cards bulk at the ${date} corpus re-pin`;
        if (row.change === "marker-removed")
            throw new Error(
                `${row.name}: the re-pin removed a retirement marker — a corpus cannot do that; stop and look`
            );
        const was = before.get(row.oracleId);
        const now = after.get(row.oracleId);
        if (was === undefined || now === undefined)
            throw new Error(
                `${row.name}: retired row changed but is missing on one side of the diff`
            );
        const fields = rowFieldChanges(was, now);
        const where = fields.length > 0 ? fields.join(", ") : "serialisation";
        return now.state === "ready"
            ? `- ${row.name} — re-derived by the compiler from the ${date} Oracle text (${where} changed); \`check:oracle\` re-proves the row is the compiler's reading of the current card`
            : `- ${row.name} — left \`ready\` (→ ${now.state}) at the ${date} corpus re-pin; its retired definition is tracked with the other losses in the roll-up issue`;
    });
}

/** Facts about one run, for the two bodies below. */
export interface RepinFacts {
    readonly date: string;
    readonly fromDate: string;
    readonly counts: {
        readonly total: number;
        readonly ready: number;
        readonly quarantine: number;
        readonly unparsed: number;
    };
    readonly fromCounts: { readonly total: number; readonly ready: number };
    readonly regressions: readonly ReadyRegression[];
    /** Each tracked loss's gap keys in the new lockfile. */
    readonly lossGaps: ReadonlyMap<string, readonly string[]>;
    readonly unclaimed: readonly UnclaimedCard[];
}

/** The roll-up issue: every loss and claim this run pointed at it. */
export function rollupIssueBody(facts: RepinFacts): string {
    const losses = trackedLosses(facts.regressions);
    const lossRows = losses.map(
        (r) =>
            `| ${r.name} | ${r.to} | ${(facts.lossGaps.get(r.oracleId) ?? []).map((k) => `\`${k}\``).join("<br>") || "—"} |`
    );
    const claimRows = facts.unclaimed.map(
        (c) =>
            `| ${c.target} | ${c.name} | ${c.missing ? `\`${c.missing.kind}\` \`${c.missing.key}\`` : "—"} |`
    );
    const cards = [...new Set(losses.map((r) => r.name))].sort();
    return [
        `Filed by the weekly corpus re-pin (issue #6387) for the ${facts.fromDate} → ${facts.date} Scryfall bulk. Every \`ready\` loss below is acknowledged in \`data/oracle-state-regressions.json\` with \`trackedBy\` this issue, and every claim below points here, so the re-pin PR could land. Triage them into Grammar Clusters (\`/cluster-gaps\`) or their own issues, then re-home the claims.`,
        "",
        "## Agent Brief",
        "",
        "**Category:** enhancement",
        `**Summary:** re-home the ${losses.length} \`ready\` loss(es) and ${facts.unclaimed.length} claim(s) the ${facts.date} corpus re-pin pointed at this roll-up.`,
        "",
        "**Current behavior:** the new Oracle text of the cards below is not read by the grammar (most often an errata rewording), so they left `ready`; the enforced Targets' unclaimed cards are claimed by this roll-up rather than by the issue that will settle them.",
        "",
        "**Desired behavior:** each loss and each claim belongs to the issue that settles it — an existing Grammar Cluster when its Signature covers the key, a new cluster or single otherwise — and this roll-up closes once none points here.",
        "",
        "### `ready` losses",
        "",
        ...(lossRows.length === 0
            ? ["None."]
            : [
                  "| Card | Now | Gap keys |",
                  "| --- | --- | --- |",
                  ...lossRows,
              ]),
        "",
        "### Claims written to this issue",
        "",
        ...(claimRows.length === 0
            ? ["None."]
            : [
                  "| Target | Card | Claim |",
                  "| --- | --- | --- |",
                  ...claimRows,
              ]),
        "",
        "## Acceptance criteria",
        "",
        "- [ ] Every loss above is `ready` again or tracked by the issue that settles it (its ledger entry is pruned after merge by `oracle:prune-regressions`).",
        "- [ ] No `data/grammar-gaps.json` claim names this issue.",
        "- [ ] Lane green at `land`.",
        "",
        ...(cards.length === 0
            ? []
            : ["## Cards", "", ...cards.map((c) => `- ${c}`), ""]),
        "## Target files",
        "",
        "- `convex/oracle/**`",
        "- `data/grammar-gaps.json`",
        "",
        "## Band",
        "",
        "P1 — cards that were playable left the compiled pool",
        "",
    ].join("\n");
}

/** The re-pin PR's body: what moved, what was settled and how, and the
 *  sections `land` reads. */
export function repinPrBody(
    facts: RepinFacts,
    rollup: number | null,
    retiredLines: readonly string[],
    claims: number
): string {
    const absent = facts.regressions.filter((r) => r.to === "absent");
    const losses = trackedLosses(facts.regressions);
    return [
        `Weekly corpus re-pin (issue #6387): Scryfall \`oracle_cards\` ${facts.fromDate} → **${facts.date}**.`,
        "",
        "## What",
        "",
        `- Lockfile: ${facts.fromCounts.total} → ${facts.counts.total} cards, ${facts.fromCounts.ready} → ${facts.counts.ready} ready (${facts.counts.quarantine} quarantine, ${facts.counts.unparsed} unparsed). Bot sweep on every changed definition.`,
        "- Regenerated: `oracle:legality`, `oracle:index`, `oracle:pool`, `catalogue:build` (Full Catalogue from today's `default_cards`). `data/catalogue/*` and the header hashes are the base's (ADR 0157).",
        `- \`ready\` losses: ${absent.length} left the corpus (\`intended\`), ${losses.length} tracked by ${rollup === null ? "—" : `issue #${rollup}`}.`,
        `- Enforced-Target claims written: ${claims}${claims > 0 && rollup !== null ? ` (to issue #${rollup})` : ""}.`,
        "- Per-gap issues for new gaps: filed by `gaps:sync` in post-merge `housekeeping`.",
        "",
        ...(retiredLines.length === 0
            ? []
            : ["## Retired rows", "", ...retiredLines, ""]),
        "## Preset scenario",
        "",
        "None owed: data-only re-pin, no `convex/{cards/sets,gre}/**` change.",
        "",
        "## Bot reachability",
        "",
        "No card definition added; the Bot-play sweep ran on every changed `ready` row.",
        "",
        "check:ui: no walk owed (data-only diff, no `src/**` change)",
        "",
    ].join("\n");
}
