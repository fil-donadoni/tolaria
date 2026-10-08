/**
 * Grammar residue ledger (issue #5222) — after a Grammar Cluster lands, which
 * of the cards it CONSIDERED are still not `ready`, and does every gap that
 * still refuses them have an OPEN issue that will resolve it?
 *
 * A rule that closes a head gap routinely UNMASKS the body gap behind it
 * (issue #4543: four of seven Target cards stayed `unparsed`, Standstill with
 * a second hidden clause). `gaps:sync` files what it sees; nothing recorded
 * which cards the ticket was about, so "the cards are still incomplete" could
 * not be told from "the cards are incomplete and tracked". This module is the
 * pure half: lockfile before + lockfile after + the claims → a ledger and the
 * HOLES (a residual gap with no claim, or a claim on a closed issue).
 *
 * PURE: the script does the I/O (git, gh, files).
 */

import { gapCards } from "./grammar-gaps";
import type { CardRow, Lockfile } from "./oracle-lockfile";
import { gapIndex, type ClaimRow, type ClusterRow } from "./targets";
import { signatureMatches } from "./gap-issues";

/** Marker making the ledger comment idempotent (one per cluster issue). */
export const LEDGER_MARKER = "<!-- grammar:residue ledger -->";

/** How a residual gap is tracked, or `none` = a hole. */
export type Tracking =
    | { readonly via: "claim"; readonly issue: number }
    | { readonly via: "cluster"; readonly issue: number }
    | { readonly via: "none" }
    | { readonly via: "closed"; readonly issue: number }
    /** No issue, but no card of an enforced Target carries it: the long tail
     *  `gaps:sync` deliberately files only above its floor (ADR 0137). Listed,
     *  never a hole. */
    | { readonly via: "tail" };

export interface ResidualGap {
    readonly key: string;
    readonly tracking: Tracking;
}

export interface ConsideredCard {
    readonly name: string;
    readonly oracleId: string;
    /** State at the merge commit. */
    readonly after: CardRow["state"];
    /** Distinct gaps still refusing the card (only when `unparsed`). */
    readonly residual: readonly ResidualGap[];
}

export interface Hole {
    readonly key: string;
    readonly tracking: Tracking;
    readonly cards: readonly string[];
}

export interface ResidueReport {
    readonly keys: readonly string[];
    readonly cards: readonly ConsideredCard[];
    readonly graduated: readonly string[];
    readonly holes: readonly Hole[];
}

/**
 * The gap keys a cluster issue lists: first column of its `## Grammar Gaps`
 * table, backticked. Empty = not a Grammar Cluster body.
 */
export function parseClusterKeys(body: string): string[] {
    const lines = body.split("\n");
    const start = lines.findIndex((l) => /^##\s+Grammar Gaps\s*$/.test(l));
    if (start === -1) return [];
    const keys: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^##\s/.test(line)) break;
        const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
        if (m) keys.push(m[1]!);
    }
    return keys;
}

export interface ResidueInput {
    /** Lockfile at the merge commit's parent — what the ticket considered. */
    readonly before: Pick<Lockfile, "cards" | "fragments">;
    /** Lockfile at the merge commit. */
    readonly after: Pick<Lockfile, "cards" | "fragments">;
    readonly keys: readonly string[];
    readonly claims: readonly ClaimRow[];
    readonly clusters: readonly ClusterRow[];
    /** Whether the issue is OPEN. Asked only about issues a residual gap names. */
    readonly isOpen: (issue: number) => boolean;
    /** Oracle ids of the enforced Targets' cards — what a hole is measured
     *  against. `null` = every considered card counts (replay, tests). */
    readonly target?: ReadonlySet<string> | null;
}

/** How one residual `key` is tracked. Claim row first, then a cluster signature. */
export function trackingOf(
    key: string,
    input: Pick<ResidueInput, "claims" | "clusters" | "isOpen">
): Tracking {
    const claim = input.claims.find(
        (c) => c.kind === "grammar" && c.key === key
    );
    if (claim !== undefined)
        return input.isOpen(claim.issue)
            ? { via: "claim", issue: claim.issue }
            : { via: "closed", issue: claim.issue };
    const cluster = input.clusters
        .filter((row) => signatureMatches(row, { kind: "grammar", key }))
        .map((row) => row.issue)
        .sort((a, b) => a - b)
        .find((issue) => input.isOpen(issue));
    return cluster !== undefined
        ? { via: "cluster", issue: cluster }
        : { via: "none" };
}

export function buildResidue(input: ResidueInput): ResidueReport {
    const seen = new Map<string, string>();
    for (const key of input.keys)
        for (const card of gapCards(input.before, key, null))
            seen.set(card.oracleId, card.name);

    const afterRows = new Map(input.after.cards.map((c) => [c.oracleId, c]));
    const { gapKeys } = gapIndex(input.after);
    const memo = new Map<string, Tracking>();
    const track = (key: string): Tracking => {
        let t = memo.get(key);
        if (t === undefined) {
            t = trackingOf(key, input);
            memo.set(key, t);
        }
        return t;
    };

    const cards: ConsideredCard[] = [];
    for (const [oracleId, name] of [...seen].sort((a, b) =>
        a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    )) {
        const row = afterRows.get(oracleId);
        // A card that left the lockfile is not a residual; report it as-is.
        const after = row?.state ?? "unparsed";
        const residual =
            row !== undefined && row.state === "unparsed"
                ? gapKeys(row).map((key) => {
                      const tracking = track(key);
                      const inTarget =
                          input.target == null || input.target.has(oracleId);
                      return {
                          key,
                          tracking:
                              tracking.via === "none" && !inTarget
                                  ? ({ via: "tail" } as const)
                                  : tracking,
                      };
                  })
                : [];
        cards.push({ name, oracleId, after, residual });
    }

    const byKey = new Map<string, { tracking: Tracking; cards: string[] }>();
    for (const card of cards)
        for (const gap of card.residual) {
            if (
                gap.tracking.via === "claim" ||
                gap.tracking.via === "cluster" ||
                gap.tracking.via === "tail"
            )
                continue;
            const slot = byKey.get(gap.key) ?? {
                tracking: gap.tracking,
                cards: [],
            };
            slot.cards.push(card.name);
            byKey.set(gap.key, slot);
        }
    const holes = [...byKey]
        .map(([key, v]) => ({ key, tracking: v.tracking, cards: v.cards }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    return {
        keys: input.keys,
        cards,
        graduated: cards
            .filter((c) => c.after !== "unparsed")
            .map((c) => c.name),
        holes,
    };
}

function trackingText(t: Tracking): string {
    switch (t.via) {
        case "claim":
            return `issue #${t.issue}`;
        case "cluster":
            return `cluster issue #${t.issue}`;
        case "closed":
            return `**HOLE** — claim issue #${t.issue} is CLOSED`;
        case "none":
            return "**HOLE** — no issue";
        case "tail":
            return "untracked long tail (no enforced Target carries it)";
    }
}

/** The markdown ledger posted on the cluster issue. */
export function renderLedger(
    report: ResidueReport,
    issue: number,
    pr: number
): string {
    const out: string[] = [
        LEDGER_MARKER,
        `## Residue ledger — issue #${issue} / PR #${pr}`,
        "",
        `${report.cards.length} card(s) considered across ${report.keys.length} gap key(s); ` +
            `${report.graduated.length} no longer \`unparsed\`, ` +
            `${report.cards.length - report.graduated.length} still \`unparsed\`.`,
        "",
        "| Card | State | Residual gap → tracked by |",
        "| --- | --- | --- |",
    ];
    for (const card of report.cards) {
        const residual =
            card.residual.length === 0
                ? "—"
                : card.residual
                      .map((g) => `\`${g.key}\` → ${trackingText(g.tracking)}`)
                      .join("<br>");
        out.push(`| ${card.name} | ${card.after} | ${residual} |`);
    }
    out.push(
        "",
        report.holes.length === 0
            ? "No holes: every residual gap has an open issue."
            : `**${report.holes.length} hole(s)** — see the rows marked HOLE.`
    );
    return out.join("\n");
}
