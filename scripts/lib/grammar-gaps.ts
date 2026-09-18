/**
 * Grammar Gaps — the lockfile's Fragments attributed to missing grammar rules
 * and ranked per Target (issue #3822, ADR 0137, PRD issue #3820 stories 1, 2
 * and 4).
 *
 * PURE over an in-memory lockfile: `oracle-report.ts` does the I/O. The
 * backlog is derived, never declared — every later grammar ticket is cut from
 * what this module prints.
 *
 * ── The gap key ────────────────────────────────────────────────────────────
 *
 * A Fragment the compiler attributed (`FragmentRow.attribution`) belongs to
 * the gap (slot, sub-grammar path, SHAPE of the unconsumed span). The shape
 * folds only what cannot change which rule is missing — the amount inside a
 * mana cost and a bare number — so "Equip {2}" and "Equip {3}" are ONE gap,
 * the parameterised Equip keyword, and not two. Everything else in the span is
 * kept verbatim: folding words would merge rules that are genuinely distinct.
 *
 * A Fragment without an attribution falls in one of two buckets: a line no
 * slot entered any sub-grammar for (keyed by its own shape — the line IS the
 * gap), or a card-level refusal — layout, type line, lowering — keyed by its
 * reason, which already names the missing capability.
 *
 * ── The Target ─────────────────────────────────────────────────────────────
 *
 * A Target is a SET OF ORACLE IDS, nothing more: a set's printings, a format
 * pool, a named list (Vintage Cube, the premodern metagame — wayfinder ticket
 * issue #3848). The ranking never learns which, so a new kind of Target plugs
 * in without touching it.
 *
 * ── The counts ─────────────────────────────────────────────────────────────
 *
 * `refuses` — the cards the gap refuses (a card counts once however many of
 * its lines fail there). `compiles` — the cards for which it is the ONLY gap
 * left, i.e. the cards that turn from `unparsed` into compiled the day the
 * rule lands; always ≤ `refuses`. Ranked by the Target's `compiles`, then its
 * `refuses`, then the corpus's `refuses` as the leverage tie-break, then the
 * key: a total order,
 * so two runs over one lockfile print one list.
 */

import type { CardRow, FragmentRow, Lockfile } from "./oracle-lockfile";

/** The frame of a line no slot entered any sub-grammar for. */
export const NO_SLOT = "(no slot)";
/** The frame of a card-level refusal (layout, type line, lowering). */
export const CARD_LEVEL = "(card)";
/**
 * The frame of a DERIVED OP CENSUS gap (ADR 0105 § 7.3): an implemented Op no
 * Compiled Definition emits, i.e. a missing grammar rule named by its Op
 * rather than by a refused span. It shares this module's key space so
 * `gaps:sync` files grammar gaps and Op gaps from ONE stable key.
 */
export const OP_LEVEL = "(op)";

/** The stable key of the Op-census gap for `op` — {@link OP_LEVEL} framed. */
export function opGapKey(op: string): string {
    return `${OP_LEVEL} › ${op}`;
}

const ROUTER_REASON = "no slot consumed the line";

export interface GrammarGap {
    readonly key: string;
    /** The slot that got furthest, or {@link NO_SLOT} / {@link CARD_LEVEL}. */
    readonly slot: string;
    /** Sub-grammars, outermost → innermost; empty for the two frames. */
    readonly path: readonly string[];
    /** The unconsumed span, shape-folded — or the card-level reason. */
    readonly shape: string;
}

export interface GapCounts {
    readonly refuses: number;
    readonly compiles: number;
}

export interface RankedGap extends GrammarGap {
    readonly target: GapCounts;
    readonly corpus: GapCounts;
    /** A refused line of the gap, from a Target card when there is one. */
    readonly example: { readonly line: string; readonly card: string };
}

/**
 * Fold what cannot change which rule is missing: a run of mana symbols is one
 * cost (`{…}`), a signed or bare integer is `N`. The card's own name marker
 * `{self}` and the non-mana symbols `{T}`, `{Q}` and `{E}` are not an amount —
 * a tap cost is a different rule from a mana cost — and survive.
 */
export function gapShape(span: string): string {
    return span
        .replace(/(?:\{(?!(?:self|T|Q|E)\})[^{}]+\})+/g, "{…}")
        .replace(/(^|[^\w{])([+\-−]?)\d+(?!\w)/g, "$1$2N");
}

/** The Grammar Gap a Fragment is attributed to. */
export function gapOf(fragment: FragmentRow): GrammarGap {
    const a = fragment.attribution;
    if (a !== undefined) {
        const shape = gapShape(a.span);
        return {
            key: [a.slot, ...a.path, shape].join(" › "),
            slot: a.slot,
            path: a.path,
            shape,
        };
    }
    if (fragment.reason === ROUTER_REASON) {
        const shape = gapShape(fragment.text);
        return { key: `${NO_SLOT} › ${shape}`, slot: NO_SLOT, path: [], shape };
    }
    return {
        key: `${CARD_LEVEL} › ${fragment.reason}`,
        slot: CARD_LEVEL,
        path: [],
        shape: fragment.reason,
    };
}

interface Tally {
    readonly gap: GrammarGap;
    target: { refuses: number; compiles: number };
    corpus: { refuses: number; compiles: number };
    example?: { line: string; card: string; inTarget: boolean };
}

/**
 * Rank the Grammar Gaps that refuse at least one card of `target` — every
 * unparsed card of the corpus when `target` is `null`.
 */
export function rankGrammarGaps(
    lock: Pick<Lockfile, "fragments" | "cards">,
    target: ReadonlySet<string> | null
): RankedGap[] {
    const gapOfFragment = lock.fragments.map(gapOf);
    const tallies = new Map<string, Tally>();
    for (const card of lock.cards) {
        if (card.state !== "unparsed" || card.gaps === undefined) continue;
        const inTarget = target === null || target.has(card.oracleId);
        const keys = distinctGaps(card, gapOfFragment);
        for (const [key, { gap, fragment }] of keys) {
            let tally = tallies.get(key);
            if (tally === undefined) {
                tally = {
                    gap,
                    target: { refuses: 0, compiles: 0 },
                    corpus: { refuses: 0, compiles: 0 },
                };
                tallies.set(key, tally);
            }
            const sole = keys.size === 1 ? 1 : 0;
            tally.corpus.refuses += 1;
            tally.corpus.compiles += sole;
            if (inTarget) {
                tally.target.refuses += 1;
                tally.target.compiles += sole;
            }
            // First Target card in lockfile order (oracle-id order), falling
            // back to the first corpus card — deterministic either way.
            if (
                tally.example === undefined ||
                (inTarget && !tally.example.inTarget)
            ) {
                tally.example = {
                    line: lock.fragments[fragment]!.text,
                    card: card.name,
                    inTarget,
                };
            }
        }
    }
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    return [...tallies.values()]
        .filter((t) => t.target.refuses > 0)
        .sort(
            (a, b) =>
                b.target.compiles - a.target.compiles ||
                b.target.refuses - a.target.refuses ||
                b.corpus.refuses - a.corpus.refuses ||
                cmp(a.gap.key, b.gap.key)
        )
        .map((t) => ({
            ...t.gap,
            target: { ...t.target },
            corpus: { ...t.corpus },
            example: { line: t.example!.line, card: t.example!.card },
        }));
}

/** A card's gaps, one entry per Grammar Gap — the first fragment kept. */
function distinctGaps(
    card: CardRow,
    gapOfFragment: readonly GrammarGap[]
): Map<string, { gap: GrammarGap; fragment: number }> {
    const out = new Map<string, { gap: GrammarGap; fragment: number }>();
    for (const index of card.gaps ?? []) {
        const gap = gapOfFragment[index]!;
        if (!out.has(gap.key)) out.set(gap.key, { gap, fragment: index });
    }
    return out;
}

/** The oracle ids of the lockfile's cards in a format pool (`poolIn`). */
export function poolTarget(
    lock: Pick<Lockfile, "cards">,
    format: string
): Set<string> {
    return new Set(
        lock.cards
            .filter((c) => c.poolIn?.includes(format as never) === true)
            .map((c) => c.oracleId)
    );
}

/**
 * The oracle ids an MTGJSON set file prints (`data/json/<SET>.json`, the
 * source `/new-set` already reads) — every card of the set, reprints
 * included, since a reprint is a card the rollout must ship too.
 */
export function setTargetFromMtgjson(json: unknown): Set<string> {
    const cards = (json as { data?: { cards?: unknown[] } }).data?.cards ?? [];
    const out = new Set<string>();
    for (const card of cards) {
        const id = (card as { identifiers?: { scryfallOracleId?: unknown } })
            .identifiers?.scryfallOracleId;
        if (typeof id === "string" && id.length > 0) out.add(id);
    }
    return out;
}
