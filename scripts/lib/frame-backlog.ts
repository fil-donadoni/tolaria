/**
 * The frame backlog (`oracle:report --frames`, issue #6632): ONE table of what
 * the Oracle grammar lacks, every unparsed gap classified by the construct
 * that would close it, so "how many issues unlock N cards" ranks across
 * classes — Verb Frame, composition head, argument class, cost, keyword,
 * layout, card-level.
 *
 * PURE over an in-memory lockfile; `oracle-report.ts` does the I/O. The row
 * key is stable across compiles (a frame is keyed by its Effect Script Op), so
 * two lockfiles compare row by row ({@link frameBacklogDelta}).
 *
 * Counts, per scope (the priority format, then the corpus):
 * `touches` — cards with a gap in the row; `alone` — cards EVERY one of whose
 * gaps is in the row, i.e. the cards that this one construct unlocks.
 */

import {
    COMPOSITION_HEADS,
    FRAME_HEADS,
    SUBJECT_LEADS,
} from "../../convex/oracle/grammar/shared/verbFrames";
import {
    CARD_LEVEL,
    NO_SLOT,
    clauseHead,
    unparsedCardGaps,
    type GrammarGap,
} from "./grammar-gaps";
import type { Lockfile } from "./oracle-lockfile";

export const ROW_CLASSES = [
    "frame",
    "composition head",
    "argument class",
    "cost",
    "keyword",
    "layout",
    "card-level",
    "other",
] as const;
export type RowClass = (typeof ROW_CLASSES)[number];

/** Where a gap lands: the row's class and its stable key. */
export interface Classified {
    readonly cls: RowClass;
    readonly key: string;
    /** A frame head whose Op is not in the Mechanics Registry. */
    readonly noOp?: boolean;
}

const PLAYER_NOUN = /^each (?:other )?(?:player|opponent)/;

function words(span: string): string[] {
    return span
        .toLowerCase()
        .replace(/^[\s"“”•—-]+/, "")
        .split(/\s+/)
        .map((w) => w.replace(/[.,;:"”'’)]+$/, ""))
        .filter((w) => w.length > 0);
}

/** Candidate singular stems of a verb as printed ("draws", "searches"). */
function stems(word: string): string[] {
    const out = [word];
    if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
    if (word.endsWith("es")) out.push(word.slice(0, -2));
    if (word.endsWith("s")) out.push(word.slice(0, -1));
    return out;
}

/** The frame head a word is, given the whole span text — or `undefined`. */
function headOf(word: string, text: string) {
    for (const stem of stems(word))
        for (const row of FRAME_HEADS)
            if (
                row.verb === stem &&
                (row.requires === undefined || text.includes(row.requires))
            )
                return row;
    return undefined;
}

export type SpanHead =
    | {
          readonly kind: "frame";
          readonly verb: string;
          readonly op: string | null;
      }
    | { readonly kind: "composition"; readonly head: string };

/**
 * The head a span opens: a verb frame (the verb first, or after a subject —
 * "Target player draws", "You may discard", "Each opponent sacrifices"), a
 * composition head (trigger / condition / duration / subject opener), or
 * `null` when neither reads.
 */
export function spanHead(span: string): SpanHead | null {
    const ws = words(span);
    const lead = ws[0];
    if (lead === undefined) return null;
    const text = ws.join(" ");
    const direct = headOf(lead, text);
    if (direct !== undefined)
        return { kind: "frame", verb: direct.verb, op: direct.op };
    const eachPlayer = PLAYER_NOUN.test(text);
    if (COMPOSITION_HEADS.includes(lead) && !eachPlayer)
        return { kind: "composition", head: lead };
    if (SUBJECT_LEADS.has(lead) || eachPlayer)
        for (const w of ws.slice(1, 8)) {
            const row = headOf(w, text);
            if (row !== undefined)
                return { kind: "frame", verb: row.verb, op: row.op };
        }
    return null;
}

/** A composition head's row key: `This <type>` keeps its subject word. */
function compositionLabel(shape: string): string {
    const [first, second] = clauseHead(shape).split(" ");
    return first === "This" && second !== undefined
        ? `${first} ${second}`
        : (first ?? "");
}

/**
 * The row a Grammar Gap falls in. `ops` is the set of registered Effect
 * Script Op names: a frame head whose Op is not in it is a `no Op` row,
 * never a frame (the Op-gap umbrella files it).
 */
export function classifyGap(
    gap: GrammarGap,
    ops: ReadonlySet<string>
): Classified {
    if (gap.slot === CARD_LEVEL) {
        const reason = gap.shape.replace(/\s*\(.*$/, "");
        return /^layout /.test(reason)
            ? { cls: "layout", key: reason }
            : { cls: "card-level", key: reason };
    }
    if (gap.slot === "keyword-line")
        return {
            cls: "keyword",
            key: `keyword › ${clauseHead(gap.shape).split(" ")[0]!.toLowerCase()}`,
        };
    if (gap.slot === "mana-ability")
        return { cls: "other", key: ["mana-ability", ...gap.path].join(" › ") };
    if (gap.path.includes("activation cost"))
        return { cls: "cost", key: "activation cost" };
    if (gap.path.length > 1 && !gap.path.every((p) => p === "effect clause"))
        return { cls: "argument class", key: gap.path.join(" > ") };
    const inEffect = gap.path[0] === "effect clause" || gap.slot === NO_SLOT;
    if (gap.path[0] === "trigger head" || gap.path[0] === "condition")
        return {
            cls: "composition head",
            key: `${gap.slot} › ${gap.path[0]} › ${compositionLabel(gap.shape)}`,
        };
    if (gap.path[0] === "static clause") {
        const head = spanHead(gap.shape);
        if (head?.kind === "frame") return frameRow(head.verb, head.op, ops);
        return {
            cls: "composition head",
            key: `static clause › ${compositionLabel(gap.shape)}`,
        };
    }
    if (inEffect) {
        const head = spanHead(gap.shape);
        if (head?.kind === "frame") return frameRow(head.verb, head.op, ops);
        if (head?.kind === "composition")
            return {
                cls: "composition head",
                key: `effect clause › ${head.head}`,
            };
        return { cls: "other", key: "(no head) › effect clause" };
    }
    return { cls: "other", key: [gap.slot, ...gap.path].join(" › ") };
}

function frameRow(
    verb: string,
    op: string | null,
    ops: ReadonlySet<string>
): Classified {
    if (op !== null && ops.has(op)) return { cls: "frame", key: op };
    return { cls: "frame", key: `no Op › ${verb}`, noOp: true };
}

export interface ScopeCounts {
    readonly touches: number;
    readonly alone: number;
}

export interface BacklogRow {
    readonly cls: RowClass;
    readonly key: string;
    readonly noOp: boolean;
    /** Distinct gap keys (forms) in the row, across the corpus. */
    readonly forms: number;
    readonly priority: ScopeCounts;
    readonly corpus: ScopeCounts;
    /** The row's most-refusing forms, by corpus cards — `[shape, cards]`. */
    readonly openings: readonly (readonly [string, number])[];
}

export interface FrameBacklog {
    readonly rows: BacklogRow[];
    /** Per-class distinct cards touched, premodern then corpus. */
    readonly subtotals: ReadonlyMap<
        RowClass,
        { priority: number; corpus: number }
    >;
    readonly priorityLabel: string;
}

interface Acc {
    cls: RowClass;
    noOp: boolean;
    forms: Map<string, number>;
    p: { touches: number; alone: number };
    c: { touches: number; alone: number };
}

const OPENINGS = 3;

/**
 * Group every unparsed card's gaps into backlog rows. `priority` is the
 * format pool the table sorts by first (premodern by default), `null` = the
 * corpus.
 */
export function buildFrameBacklog(
    lock: Pick<Lockfile, "fragments" | "cards">,
    ops: ReadonlySet<string>,
    priority: ReadonlySet<string>,
    priorityLabel: string
): FrameBacklog {
    const accs = new Map<string, Acc>();
    const sub = new Map<RowClass, { priority: number; corpus: number }>();
    for (const { card, gaps } of unparsedCardGaps(lock)) {
        const inPriority = priority.has(card.oracleId);
        const rows = new Map<string, { c: Classified; forms: Set<string> }>();
        for (const [gapKey, { gap }] of gaps) {
            const c = classifyGap(gap, ops);
            const id = `${c.cls}\u0000${c.key}`;
            const hit = rows.get(id);
            if (hit === undefined)
                rows.set(id, { c, forms: new Set([gapKey]) });
            else hit.forms.add(gapKey);
        }
        const classes = new Set<RowClass>();
        for (const [id, { c, forms }] of rows) {
            let acc = accs.get(id);
            if (acc === undefined) {
                acc = {
                    cls: c.cls,
                    noOp: c.noOp === true,
                    forms: new Map(),
                    p: { touches: 0, alone: 0 },
                    c: { touches: 0, alone: 0 },
                };
                accs.set(id, acc);
            }
            const alone = rows.size === 1 ? 1 : 0;
            acc.c.touches += 1;
            acc.c.alone += alone;
            if (inPriority) {
                acc.p.touches += 1;
                acc.p.alone += alone;
            }
            for (const form of forms)
                acc.forms.set(form, (acc.forms.get(form) ?? 0) + 1);
            classes.add(c.cls);
        }
        for (const cls of classes) {
            const s = sub.get(cls) ?? { priority: 0, corpus: 0 };
            s.corpus += 1;
            if (inPriority) s.priority += 1;
            sub.set(cls, s);
        }
    }
    const rows: BacklogRow[] = [...accs.entries()].map(([id, a]) => ({
        cls: a.cls,
        key: id.slice(id.indexOf("\u0000") + 1),
        noOp: a.noOp,
        forms: a.forms.size,
        priority: { ...a.p },
        corpus: { ...a.c },
        openings: [...a.forms.entries()]
            .map(([k, n]) => [formShape(k), n] as const)
            .sort(
                (x, y) =>
                    y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)
            )
            .slice(0, OPENINGS),
    }));
    return { rows: sortRows(rows), subtotals: sub, priorityLabel };
}

/** A gap key's span: the shape after its last ` › `. */
function formShape(key: string): string {
    return key.slice(key.lastIndexOf(" › ") + 3);
}

/** Priority touches, then corpus touches, then class and key: total order. */
function sortRows(rows: BacklogRow[]): BacklogRow[] {
    return rows.sort(
        (a, b) =>
            b.priority.touches - a.priority.touches ||
            b.corpus.touches - a.corpus.touches ||
            (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0) ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
}

/** Rows with at least `tail` corpus cards touched — the table's cut. */
export function tailCut(
    rows: readonly BacklogRow[],
    tail: number
): BacklogRow[] {
    return rows.filter((r) => r.corpus.touches >= tail);
}

export interface BacklogMove {
    readonly cls: RowClass;
    readonly key: string;
    readonly priority: number;
    readonly corpus: number;
    readonly priorityAlone: number;
    readonly corpusAlone: number;
}

/**
 * Per-row movement of `touches` / `alone` from `before` to `after`, rows that
 * moved only: negative = cards the construct no longer blocks.
 */
export function frameBacklogDelta(
    before: FrameBacklog,
    after: FrameBacklog
): BacklogMove[] {
    const id = (r: BacklogRow): string => `${r.cls}\u0000${r.key}`;
    const was = new Map(before.rows.map((r) => [id(r), r] as const));
    const seen = new Set<string>();
    const out: BacklogMove[] = [];
    const move = (now: BacklogRow | undefined, old: BacklogRow | undefined) => {
        const r = (now ?? old)!;
        const m = {
            cls: r.cls,
            key: r.key,
            priority:
                (now?.priority.touches ?? 0) - (old?.priority.touches ?? 0),
            corpus: (now?.corpus.touches ?? 0) - (old?.corpus.touches ?? 0),
            priorityAlone:
                (now?.priority.alone ?? 0) - (old?.priority.alone ?? 0),
            corpusAlone: (now?.corpus.alone ?? 0) - (old?.corpus.alone ?? 0),
        };
        if (
            m.priority !== 0 ||
            m.corpus !== 0 ||
            m.priorityAlone !== 0 ||
            m.corpusAlone !== 0
        )
            out.push(m);
    };
    for (const r of after.rows) {
        seen.add(id(r));
        move(r, was.get(id(r)));
    }
    for (const r of before.rows) if (!seen.has(id(r))) move(undefined, r);
    return out.sort(
        (a, b) =>
            a.priority - b.priority ||
            a.corpus - b.corpus ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
}

const WIDTH = 78;

function clip(text: string, width: number): string {
    return text.length > width ? `${text.slice(0, width - 3)}...` : text;
}

const num = (n: number, w: number): string => String(n).padStart(w);

/**
 * The table as text: one row per construct, a `class` column, then a
 * per-class subtotal block (distinct cards, so a card in two rows counts once
 * per class). `tail` is the corpus-card floor of a printed row.
 */
export function formatFrameBacklog(b: FrameBacklog, tail: number): string {
    const shown = tailCut(b.rows, tail);
    const p = b.priorityLabel;
    const lines = [
        `Frame backlog — ${shown.length} of ${b.rows.length} rows with ≥ ${tail} corpus cards`,
        `touches = cards with a gap in the row; alone = cards EVERY gap of which is in the row`,
        `(the cards that one construct unlocks); ${p} first, then the corpus`,
        "",
        `${"class".padEnd(18)}${"row".padEnd(46)}${`${p} t/a`.padStart(13)}${"corpus t/a".padStart(13)}${"forms".padStart(7)}`,
    ];
    for (const r of shown) {
        const flag = r.noOp ? "  [no Op]" : "";
        lines.push(
            `${r.cls.padEnd(18)}${clip(r.key, 45).padEnd(46)}` +
                `${`${r.priority.touches}/${r.priority.alone}`.padStart(13)}` +
                `${`${r.corpus.touches}/${r.corpus.alone}`.padStart(13)}` +
                `${num(r.forms, 7)}${flag}`
        );
        for (const [shape, n] of r.openings)
            lines.push(
                `${"".padEnd(18)}  ${num(n, 5)}  ${clip(shape, WIDTH - 24)}`
            );
    }
    lines.push("", "Per-class subtotals (distinct cards touched):");
    for (const cls of ROW_CLASSES) {
        const s = b.subtotals.get(cls);
        if (s !== undefined)
            lines.push(
                `${cls.padEnd(18)}${p} ${num(s.priority, 6)}   corpus ${num(s.corpus, 6)}`
            );
    }
    return `${lines.join("\n")}\n`;
}

/** The per-row movement table, biggest drop first. */
export function formatFrameDelta(
    moves: readonly BacklogMove[],
    label: string,
    ref: string
): string {
    const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
    const lines = [
        `Frame backlog delta against ${ref} (touches / alone; negative = unblocked)`,
        `${"class".padEnd(18)}${"row".padEnd(46)}${`${label} t/a`.padStart(13)}${"corpus t/a".padStart(13)}`,
    ];
    for (const m of moves)
        lines.push(
            `${m.cls.padEnd(18)}${clip(m.key, 45).padEnd(46)}` +
                `${`${sign(m.priority)}/${sign(m.priorityAlone)}`.padStart(13)}` +
                `${`${sign(m.corpus)}/${sign(m.corpusAlone)}`.padStart(13)}`
        );
    if (moves.length === 0) lines.push("(no row moved)");
    return `${lines.join("\n")}\n`;
}
