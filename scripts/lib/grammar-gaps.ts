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

/**
 * ── The Clause Family (ADR 0152 § 1, GLOSSARY **Clause Family**) ───────────
 *
 * The key is too fine to cut work by: "Whenever you cast a red spell" and
 * "… a noncreature spell" are two keys, one missing construct. A Clause Family
 * groups gaps by slot, sub-grammar path and the HEAD of the span — its first
 * {@link CLAUSE_FAMILY_HEAD_WORDS} words once the {@link CLAUSE_FAMILY_FOLDS}
 * placeholders are folded on top of `gapShape`. The leading word is kept
 * literal: it is the keyword or ability word that names the rule ("Equip" and
 * "Cycling" are two rules, however alike their costs). A card-level gap is its
 * own family, unchanged — its reason already names the capability.
 *
 * DERIVED, never stored: claims, the lockfile and `matchCluster` key on the gap
 * key. Both constants are tuned by one measure — families, singles and cards
 * freed by the top K families (PRD issue #5193).
 */
export const CLAUSE_FAMILY_HEAD_WORDS = 4;

/**
 * Words folded to a placeholder in a span's head (after its leading word).
 * Card-type words also match plural and `non`-prefixed: "noncreature",
 * "sorceries". A capitalised word after the leading one is a subtype and folds
 * to `<type>`; a P/T pair (`+N/+N`, `X/X`) to `<pt>`; `a`/`an` to `a`.
 */
export const CLAUSE_FAMILY_FOLDS = {
    "<colour>": [
        "white",
        "blue",
        "black",
        "red",
        "green",
        "colorless",
        "multicolored",
        "monocolored",
    ],
    "<type>": [
        "artifact",
        "battle",
        "creature",
        "enchantment",
        "instant",
        "kindred",
        "land",
        "planeswalker",
        "sorcery",
        "tribal",
    ],
    "<number>": [
        "N",
        "X",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
    ],
    "<player>": ["you", "opponent", "opponents", "player", "players"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const FOLD_OF = new Map<string, string>(
    Object.entries(CLAUSE_FAMILY_FOLDS).flatMap(([placeholder, words]) =>
        words.map((w) => [w, placeholder] as const)
    )
);
const PT = /^[+\-−]?(?:N|X|\*)\/[+\-−]?(?:N|X|\*)$/;

/** A word after one of these opens a sentence: its capital is not a subtype. */
const SENTENCE_BREAK = /(?:[.:•]|—)$/;

/** One head word folded — the word's trailing punctuation dropped. */
function foldWord(raw: string, opensSentence: boolean): string {
    const word = raw.replace(/[.,;:]+$/, "");
    if (PT.test(word)) return "<pt>";
    const direct = FOLD_OF.get(word) ?? FOLD_OF.get(word.toLowerCase());
    if (direct !== undefined) return direct;
    const lower = word.toLowerCase();
    const bare = lower.replace(/^non-?/, "");
    const singular = bare.endsWith("ies")
        ? `${bare.slice(0, -3)}y`
        : bare.replace(/s$/, "");
    for (const w of [bare, singular])
        if (FOLD_OF.get(w) === "<type>" || FOLD_OF.get(w) === "<colour>")
            return FOLD_OF.get(w)!;
    if (lower === "an") return "a";
    if (!opensSentence && /^[A-Z][a-z]/.test(word)) return "<type>";
    return word;
}

/** A span's head: its leading word literal, the rest folded, then clipped. */
export function clauseHead(shape: string): string {
    const words = shape.split(/\s+/).filter((w) => w.length > 0);
    const [lead, ...rest] = words;
    if (lead === undefined) return "";
    const folded = rest.map((w, i) =>
        foldWord(w, SENTENCE_BREAK.test(words[i]!))
    );
    return [lead.replace(/[.,;:]+$/, ""), ...folded]
        .slice(0, CLAUSE_FAMILY_HEAD_WORDS)
        .join(" ");
}

/** The Clause Family a Grammar Gap belongs to — a label, never a key. */
export function clauseFamily(gap: GrammarGap): string {
    if (gap.slot === CARD_LEVEL) return gap.key;
    return [gap.slot, ...gap.path, clauseHead(gap.shape)].join(" › ");
}

interface Tally {
    readonly gap: GrammarGap;
    /** The gap keys the group holds — one for a gap, its forms for a family. */
    readonly keys: Set<string>;
    target: { refuses: number; compiles: number };
    corpus: { refuses: number; compiles: number };
    example?: { line: string; card: string; inTarget: boolean };
}

/**
 * Count every unparsed card against the groups its gaps fall in — a group is
 * a gap key or a Clause Family, `groupOf` decides. A card refuses once per
 * group however many of its gaps fall there, and the group compiles it only
 * when it is the card's ONLY group: every gap of the card falls in it.
 */
function tallyGroups(
    lock: Pick<Lockfile, "fragments" | "cards">,
    target: ReadonlySet<string> | null,
    groupOf: (gap: GrammarGap) => string
): Tally[] {
    const gapOfFragment = lock.fragments.map(gapOf);
    const tallies = new Map<string, Tally>();
    for (const card of lock.cards) {
        if (card.state !== "unparsed" || card.gaps === undefined) continue;
        const inTarget = target === null || target.has(card.oracleId);
        const groups = new Map<
            string,
            { gap: GrammarGap; fragment: number; keys: Set<string> }
        >();
        for (const [key, { gap, fragment }] of distinctGaps(
            card,
            gapOfFragment
        )) {
            const group = groupOf(gap);
            const hit = groups.get(group);
            if (hit === undefined)
                groups.set(group, { gap, fragment, keys: new Set([key]) });
            else hit.keys.add(key);
        }
        for (const [group, { gap, fragment, keys }] of groups) {
            let tally = tallies.get(group);
            if (tally === undefined) {
                tally = {
                    gap,
                    keys: new Set(),
                    target: { refuses: 0, compiles: 0 },
                    corpus: { refuses: 0, compiles: 0 },
                };
                tallies.set(group, tally);
            }
            for (const key of keys) tally.keys.add(key);
            const sole = groups.size === 1 ? 1 : 0;
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
    return [...tallies.values()].filter((t) => t.target.refuses > 0);
}

/** Target compiles, Target refuses, corpus refuses, then `label`: total. */
function byLeverage<T extends { target: GapCounts; corpus: GapCounts }>(
    rows: T[],
    label: (row: T) => string
): T[] {
    const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    return rows.sort(
        (a, b) =>
            b.target.compiles - a.target.compiles ||
            b.target.refuses - a.target.refuses ||
            b.corpus.refuses - a.corpus.refuses ||
            cmp(label(a), label(b))
    );
}

/**
 * Rank the Grammar Gaps that refuse at least one card of `target` — every
 * unparsed card of the corpus when `target` is `null`.
 */
export function rankGrammarGaps(
    lock: Pick<Lockfile, "fragments" | "cards">,
    target: ReadonlySet<string> | null
): RankedGap[] {
    const ranked = tallyGroups(lock, target, (gap) => gap.key).map((t) => ({
        ...t.gap,
        target: { ...t.target },
        corpus: { ...t.corpus },
        example: { line: t.example!.line, card: t.example!.card },
    }));
    return byLeverage(ranked, (g) => g.key);
}

export interface RankedFamily {
    /** The Clause Family label (`clauseFamily`). */
    readonly family: string;
    readonly slot: string;
    readonly path: readonly string[];
    /** The folded head — or, for a card-level family, the refusal's reason. */
    readonly head: string;
    /** Distinct gap keys (shapes) of the family that refuse a counted card. */
    readonly forms: number;
    /** `compiles` = cards EVERY one of whose gaps falls in the family. */
    readonly target: GapCounts;
    readonly corpus: GapCounts;
    readonly example: { readonly line: string; readonly card: string };
}

/**
 * Rank the Clause Families that refuse at least one card of `target` (ADR
 * 0152 § 1) — the grammar backlog by missing construct rather than by exact
 * sentence. Counts and order mirror {@link rankGrammarGaps}, family for key.
 * `forms` counts across the corpus: the cut sizes a family there (§ 4).
 */
export function rankClauseFamilies(
    lock: Pick<Lockfile, "fragments" | "cards">,
    target: ReadonlySet<string> | null
): RankedFamily[] {
    const ranked = tallyGroups(lock, target, clauseFamily).map((t) => ({
        family: clauseFamily(t.gap),
        slot: t.gap.slot,
        path: t.gap.path,
        head: t.gap.slot === CARD_LEVEL ? t.gap.shape : clauseHead(t.gap.shape),
        forms: t.keys.size,
        target: { ...t.target },
        corpus: { ...t.corpus },
        example: { line: t.example!.line, card: t.example!.card },
    }));
    return byLeverage(ranked, (f) => f.family);
}

/**
 * The gap keys a `--gap` query names: the one key equal to `query` when there
 * is one, else every key CONTAINING it (sorted). The printed ranking clips a
 * long span, so a reader copies a unique substring rather than retyping the
 * key — and an ambiguous substring must come back as the list to choose from,
 * never as the first match.
 */
export function findGapKeys(
    lock: Pick<Lockfile, "fragments" | "cards">,
    query: string
): string[] {
    const keys = new Set<string>();
    for (const card of lock.cards) {
        if (card.state !== "unparsed" || card.gaps === undefined) continue;
        for (const index of card.gaps)
            keys.add(gapOf(lock.fragments[index]!).key);
    }
    if (keys.has(query)) return [query];
    return [...keys].filter((k) => k.includes(query)).sort();
}

/** One card a Grammar Gap refuses, with the line of its that fails there. */
export interface GapCard {
    readonly name: string;
    readonly oracleId: string;
    /** The card's first refused line attributed to the gap. */
    readonly line: string;
    /** The gap is the card's ONLY one: the rule alone makes it compile. */
    readonly sole: boolean;
    readonly inTarget: boolean;
}

/**
 * Every card the gap `key` refuses — the evidence a Grammar Rule is written
 * against (`/grammar-rule`, issue #3834). Sole-gap cards first (the ones the
 * rule graduates), Target cards before the rest, then by name: the same
 * counts `rankGrammarGaps` prints, card by card.
 */
export function gapCards(
    lock: Pick<Lockfile, "fragments" | "cards">,
    key: string,
    target: ReadonlySet<string> | null
): GapCard[] {
    const gapOfFragment = lock.fragments.map(gapOf);
    const out: GapCard[] = [];
    for (const card of lock.cards) {
        if (card.state !== "unparsed" || card.gaps === undefined) continue;
        const keys = distinctGaps(card, gapOfFragment);
        const hit = keys.get(key);
        if (hit === undefined) continue;
        out.push({
            name: card.name,
            oracleId: card.oracleId,
            line: lock.fragments[hit.fragment]!.text,
            sole: keys.size === 1,
            inTarget: target === null || target.has(card.oracleId),
        });
    }
    const rank = (c: GapCard): number =>
        (c.sole ? 0 : 2) + (c.inTarget ? 0 : 1);
    return out.sort(
        (a, b) =>
            rank(a) - rank(b) ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
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
