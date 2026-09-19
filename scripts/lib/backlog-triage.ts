/**
 * `backlog:triage` — the band rule of issue #3851 decision 3, as a PURE
 * function (issue #4054). `scripts/backlog-triage.ts` does the I/O (the open
 * issues with their edges, the board's `Priority` map, the lockfile); nothing
 * here talks to `gh`, which is what makes the rule testable on synthetic
 * inputs.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * `P0` is strict actuality, days, HAND-SET only: the rule never produces it
 * and never clears it — an issue the board holds at `P0` is reported as
 * untouched and computed no further. Every other open issue takes the
 * STRONGEST band of three sources:
 *
 * | Source                                  | P1                       | P2            | P3                  |
 * | --------------------------------------- | ------------------------ | ------------- | ------------------- |
 * | Cards it unlocks or names (lockfile)    | `premodern-metagame` / `tier1-*` | `vintage-cube` | only `set-*` / `format-*` |
 * | Blocking edge                           | blocks a P1              | blocks a P2   | blocks a P3         |
 * | Parent (band inheritance, issue #3212)  | parent P1                | parent P2     | parent P3           |
 *
 * PRD #3820 and its direct children are `P1` by fiat (`fiat`). No source
 * yields a band → **residue**: it stays unprioritized and the report lists it
 * for the owner. Residue never falls into `P3` — "the rule abstained" and "the
 * owner ruled later" must not read the same.
 *
 * ── One level, never a fixpoint ─────────────────────────────────────────
 *
 * A neighbour (the issue an edge blocks, or the parent) is read by its SEED
 * band — fiat or cards, the two sources that need no neighbour of their own —
 * so a band travels exactly one hop, as #3212's inheritance does. No cycle can
 * loop by construction, and an edge pointing at residue contributes nothing.
 *
 * The two neighbours differ in what else they read from the board, on purpose:
 *
 *   - a PARENT is also read by its board value — that IS band inheritance
 *     (`effectivePriority` in `queue-plan.ts` reads the parent's board value),
 *     and an umbrella's band is hand-set by the owner (decision 7: one PRD per
 *     band), with no cards of its own to seed it;
 *   - a BLOCKED issue is read by its seed plus a hand-set `P0` only. Reading
 *     its whole board value would let a band this script wrote on the last run
 *     travel one more hop on the next one — a fixpoint spread over runs.
 *
 * A neighbour at `P0` yields `P1`: the script never writes `P0`.
 */

import { PRD_ISSUE } from "./gap-issues";
import { cardsNamedByTitle } from "./gap-kinds";
import type { BoardPriority } from "./board-priority";
import { declaredSection, fencedLines } from "./declared-section";
import type { CardRow, Lockfile } from "./oracle-lockfile";
import { quarantineClass, type ClaimRow } from "./targets";

/** The bands the rule may WRITE — never `P0`. */
export type Band = "P1" | "P2" | "P3";
export const BANDS: readonly Band[] = ["P1", "P2", "P3"];

/** Which source produced a band, in tie-break order. */
export type BandSource = "fiat" | "cards" | "edge" | "parent";
const SOURCE_ORDER: readonly BandSource[] = ["fiat", "cards", "edge", "parent"];

/** The band a registered Target lends its cards, by id — `null` for a Target
 *  the rule does not rank (it lends nothing, it does not demote). */
export function targetBand(targetId: string): Band | null {
    if (targetId === "premodern-metagame" || targetId.startsWith("tier1-"))
        return "P1";
    if (targetId === "vintage-cube") return "P2";
    if (targetId.startsWith("set-") || targetId.startsWith("format-"))
        return "P3";
    return null;
}

const rank = (band: Band): number => BANDS.indexOf(band);

function stronger(a: Band | null, b: Band | null): Band | null {
    if (a === null) return b;
    if (b === null) return a;
    return rank(a) <= rank(b) ? a : b;
}

/** A board value as a band a NEIGHBOUR lends — `P0` lends `P1`. */
function lent(value: BoardPriority | undefined): Band | null {
    if (value === undefined) return null;
    return value === "P0" ? "P1" : value;
}

/** The inverse Target index: oracle id → the strongest band (and the Target
 *  lending it) of any registered Target that requires the card. */
export interface CardBand {
    readonly band: Band;
    readonly target: string;
}

export function cardBandIndex(
    targets: readonly { readonly id: string; readonly ids: Iterable<string> }[]
): Map<string, CardBand> {
    const index = new Map<string, CardBand>();
    for (const target of targets) {
        const band = targetBand(target.id);
        if (band === null) continue;
        for (const id of target.ids) {
            const held = index.get(id);
            if (held === undefined || rank(band) < rank(held.band))
                index.set(id, { band, target: target.id });
        }
    }
    return index;
}

/**
 * The cards source of the rule on its own: the strongest band any of `cards`
 * lends, with the Target lending it — `null` when none is in a ranked Target.
 * The ONE place that decision is made: `triage` seeds from it, and `gaps:sync`
 * picks a gap's band umbrella from it (issue #4056), so the partition cannot
 * drift from the axis it partitions.
 */
export function strongestCardBand(
    cards: Iterable<string>,
    index: ReadonlyMap<string, CardBand>
): CardBand | null {
    let best: CardBand | null = null;
    for (const id of cards) {
        const held = index.get(id);
        if (held === undefined) continue;
        if (best === null || rank(held.band) < rank(best.band)) best = held;
    }
    return best;
}

/**
 * The cards each issue UNLOCKS through the claims it settles — one claim row,
 * one issue (`data/grammar-gaps.json`), resolved on the lockfile with the same
 * key scheme the filer used:
 *
 *   - `grammar` — the cards whose lockfile gaps carry the key (an Op-census
 *     `(op) › …` key carries none by construction, issue #3974);
 *   - `mechanic` / `scenario` — the cards whose quarantine reasons map to the
 *     class (`quarantineClass`);
 *   - `hand-tail` — the card the key names, if the lockfile resolves it.
 *
 * `bot` and `migration` rows unlock no Target card (`targets.ts`, CLAIM_KINDS)
 * and contribute nothing.
 */
export function claimedCards(
    claims: readonly ClaimRow[],
    lock: Pick<Lockfile, "cards">,
    gapKeys: (row: CardRow) => readonly string[],
    byName: (name: string) => string | undefined
): Map<number, Set<string>> {
    const wanted = new Map<string, number[]>();
    for (const claim of claims) {
        const id = `${claim.kind}\t${claim.key}`;
        wanted.set(id, [...(wanted.get(id) ?? []), claim.issue]);
    }
    const out = new Map<number, Set<string>>();
    const add = (id: string, oracleId: string): void => {
        for (const issue of wanted.get(id) ?? []) {
            const set = out.get(issue) ?? new Set<string>();
            set.add(oracleId);
            out.set(issue, set);
        }
    };
    for (const row of lock.cards) {
        for (const key of gapKeys(row)) add(`grammar\t${key}`, row.oracleId);
        for (const reason of row.quarantineReasons ?? []) {
            const cls = quarantineClass(reason);
            add(`${cls.kind}\t${cls.key}`, row.oracleId);
        }
    }
    for (const claim of claims) {
        if (claim.kind !== "hand-tail") continue;
        const oracleId = byName(claim.key);
        if (oracleId !== undefined) add(`hand-tail\t${claim.key}`, oracleId);
    }
    return out;
}

/** `[engine] Impending keyword (CR 702.176) — blocks Overlord of the Balemurk` */
const ENGINE_TITLE = /^\s*\[engine\][^\n]*\s—\s(.+)$/i;
/** The one verb an engine title may open its tail with. */
const TAIL_VERB = /^(?:un)?blocks?\s+|^ships?\s+/i;
/** A trailing `(#1120 gap 2)` / `(CR …)` aside is not part of a name. */
const TAIL_ASIDE = /\s*\([^)]*\)\s*$/;

/**
 * The cards an `[engine] … — <Card>` title names in its LAST em-dash tail,
 * with `cardsNamedByTitle`'s contract: every name must resolve on the lockfile
 * or the title yields NONE. Nothing is inferred from prose — the tail, less
 * one optional `blocks`/`unblocks`/`ships` verb and one trailing parenthetical,
 * is tried whole first (a name may carry a comma: `Wan Shi Tong, Librarian`),
 * then split on `, `, ` + `, ` / ` or ` and `. A tail that is a clause
 * (`— blocks DSL migration`) resolves nothing and names nothing.
 */
export function cardsNamedByEngineTitle(
    issueTitle: string,
    byName: (name: string) => string | undefined
): string[] {
    const m = ENGINE_TITLE.exec(issueTitle);
    if (m === null) return [];
    const tail = m[1]!.split(" — ").pop()!;
    const bare = tail.replace(TAIL_ASIDE, "").replace(TAIL_VERB, "").trim();
    if (bare.length === 0) return [];
    if (byName(bare) !== undefined) return [bare];
    const names = bare.split(/,\s+|\s\+\s|\s\/\s|\sand\s/).map((n) => n.trim());
    if (names.some((n) => n.length === 0 || byName(n) === undefined)) return [];
    return names;
}

const CARDS_HEADING = /^#{1,6}\s+cards\s*$/i;
/** One inline wrapper a writer may put round a name: `` `X` `` or `**X**`. */
const NAME_WRAPPER = /^(?:`([^`]+)`|\*\*([^*]+)\*\*)$/;

/**
 * Read one body's `## Cards` section (issue #4086) — the cards the issue is
 * ABOUT, declared, one lockfile name per list item. `names` are the items as
 * written (less one `` ` ``/`**` wrapper); `unreadable` the prose lines, which
 * are reported and never read. `null` when the body has no such section —
 * not the same as `None.`, which declares nothing (`names: []`). Fenced code
 * is not markdown here — `declaredSection` owns that, and why.
 *
 * Nothing is resolved here: the contract is per LINE, so a name the lockfile
 * cannot resolve is the caller's to report (`resolveDeclaredCards`).
 */
export function parseCards(
    body: string
): { names: string[]; unreadable: string[] } | null {
    const section = declaredSection(body, CARDS_HEADING);
    if (section === null) return null;
    const names: string[] = [];
    const unreadable: string[] = [];
    for (const { raw, item } of section) {
        if (item === null) {
            unreadable.push(raw);
            continue;
        }
        const t = item.trim();
        const w = NAME_WRAPPER.exec(t);
        names.push((w === null ? t : (w[1] ?? w[2])!).trim());
    }
    return { names, unreadable };
}

/** One `## Cards` line that bands nothing — printed, never dropped. */
export interface CardsResidue {
    readonly issue: number;
    readonly line: string;
    readonly reason: "no such card" | "unreadable";
}

/**
 * Resolve one body's `## Cards` declaration, per LINE: a declared name is a
 * deliberate statement, so one typo must not silence the other lines — the
 * resolvable ones come back as oracle ids, every other line as residue.
 * The opposite of the title's all-or-nothing contract, and on purpose: a
 * title is read out of a sentence, this section is written to be read.
 */
export function resolveDeclaredCards(
    issue: number,
    body: string,
    byName: (name: string) => string | undefined
): { ids: string[]; residue: CardsResidue[] } {
    const parsed = parseCards(body);
    if (parsed === null) return { ids: [], residue: [] };
    const ids = new Set<string>();
    const residue: CardsResidue[] = parsed.unreadable.map((line) => ({
        issue,
        line,
        reason: "unreadable",
    }));
    for (const name of parsed.names) {
        const id = byName(name);
        if (id === undefined)
            residue.push({ issue, line: name, reason: "no such card" });
        else ids.add(id);
    }
    return { ids: [...ids].sort(), residue };
}

/** A strict span: a whole `` `…` `` or `**…**` run on one line. */
const STRICT_SPAN = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

/**
 * The `--suggest-cards` backfill (issue #4086): the STRICT spans of a body —
 * a `` `Name` `` / `**Name**` run that is exactly the name of a card some
 * ranked Target requires — as the lockfile names them, first mention first.
 * Fenced code is skipped. A PROPOSAL, never a declaration: a span naming a
 * code identifier that happens to equal a card name is exactly why a human
 * confirms it before it is pasted.
 */
export function suggestCards(
    body: string,
    byName: (name: string) => string | undefined,
    ranked: ReadonlySet<string>
): string[] {
    const lines = body.split("\n");
    const fenced = fencedLines(lines);
    const out: string[] = [];
    const seen = new Set<string>();
    lines.forEach((line, i) => {
        if (fenced.has(i)) return;
        for (const m of line.matchAll(STRICT_SPAN)) {
            const name = (m[1] ?? m[2])!.trim();
            const id = byName(name);
            if (id === undefined || !ranked.has(id) || seen.has(id)) continue;
            seen.add(id);
            out.push(name);
        }
    });
    return out;
}

/** The `--suggest-cards` block: per residue issue, a ready-to-paste section. */
export function renderSuggestions(
    suggestions: readonly {
        readonly number: number;
        readonly names: readonly string[];
    }[]
): string {
    const hits = suggestions.filter((s) => s.names.length > 0);
    const lines = [
        "",
        `## Cards suggestions — PROPOSED, nothing written; confirm each against the body before pasting: ${hits.length}`,
    ];
    for (const s of hits)
        lines.push(
            "",
            `#${s.number}`,
            "## Cards",
            "",
            ...s.names.map((n) => `- ${n}`)
        );
    return lines.join("\n");
}

/**
 * Every card an issue unlocks or names: the claim cards, the title's names —
 * `cardsNamedByTitle` for a `[card] … —` title, whose contract is kept whole,
 * and {@link cardsNamedByEngineTitle} for an `[engine] … — <Card>` one — and
 * the ids its `## Cards` section declares ({@link resolveDeclaredCards}). A
 * title naming a card the lockfile cannot resolve yields NO names, since a
 * guess would misband a real slice.
 */
export function issueCards(
    issue: { readonly number: number; readonly title: string },
    claimed: ReadonlyMap<number, ReadonlySet<string>>,
    byName: (name: string) => string | undefined,
    declared: readonly string[] = []
): string[] {
    const ids = new Set([...(claimed.get(issue.number) ?? []), ...declared]);
    for (const name of [
        ...cardsNamedByTitle(issue.title, byName),
        ...cardsNamedByEngineTitle(issue.title, byName),
    ])
        ids.add(byName(name)!);
    return [...ids].sort();
}

/** One open issue as the rule reads it. */
export interface TriageIssue {
    readonly number: number;
    readonly title: string;
    readonly parent: number | null;
    /** The issues this one BLOCKS (it is their `blocked by`). */
    readonly blocks: readonly number[];
    /** Oracle ids it unlocks or names — {@link issueCards}. */
    readonly cards: readonly string[];
}

export type TriageVerdict =
    | { readonly kind: "p0" }
    | {
          readonly kind: "band";
          readonly band: Band;
          readonly source: BandSource;
          /** What lent it: a Target id (`cards`), an issue number (`edge`,
           *  `parent`, `fiat`). */
          readonly via: string;
      }
    | { readonly kind: "residue" };

/**
 * THE rule. Pure: the open issues with their parent and blocking edges, the
 * card → strongest-Target index, the current board map in; per issue a band
 * with the source that produced it, `p0` (untouched), or `residue` out.
 *
 * `fiatRoot` is PRD #3820 — it and its direct children are `P1` by fiat.
 */
export function triage(
    issues: readonly TriageIssue[],
    index: ReadonlyMap<string, CardBand>,
    board: Readonly<Record<number, BoardPriority>>,
    fiatRoot: number = PRD_ISSUE
): Map<number, TriageVerdict> {
    const byNumber = new Map(issues.map((i) => [i.number, i] as const));

    type Candidate = { band: Band; source: BandSource; via: string };
    const seedCandidates = (issue: TriageIssue): Candidate[] => {
        const out: Candidate[] = [];
        if (issue.number === fiatRoot || issue.parent === fiatRoot)
            out.push({ band: "P1", source: "fiat", via: `#${fiatRoot}` });
        const best = strongestCardBand(issue.cards, index);
        if (best !== null)
            out.push({ band: best.band, source: "cards", via: best.target });
        return out;
    };
    const seedBand = (n: number): Band | null => {
        const issue = byNumber.get(n);
        if (issue === undefined) return null;
        return seedCandidates(issue).reduce<Band | null>(
            (acc, c) => stronger(acc, c.band),
            null
        );
    };

    const verdicts = new Map<number, TriageVerdict>();
    for (const issue of issues) {
        if (board[issue.number] === "P0") {
            verdicts.set(issue.number, { kind: "p0" });
            continue;
        }
        const candidates = seedCandidates(issue);
        for (const blocked of [...issue.blocks].sort((a, b) => a - b)) {
            const band = stronger(
                seedBand(blocked),
                board[blocked] === "P0" ? "P1" : null
            );
            if (band !== null)
                candidates.push({ band, source: "edge", via: `#${blocked}` });
        }
        if (issue.parent !== null) {
            const band = stronger(
                seedBand(issue.parent),
                lent(board[issue.parent])
            );
            if (band !== null)
                candidates.push({
                    band,
                    source: "parent",
                    via: `#${issue.parent}`,
                });
        }
        if (candidates.length === 0) {
            verdicts.set(issue.number, { kind: "residue" });
            continue;
        }
        const best = candidates.reduce((a, b) =>
            rank(b.band) < rank(a.band) ||
            (rank(b.band) === rank(a.band) &&
                SOURCE_ORDER.indexOf(b.source) < SOURCE_ORDER.indexOf(a.source))
                ? b
                : a
        );
        verdicts.set(issue.number, { kind: "band", ...best });
    }
    return verdicts;
}

/** The per-class diff against the board — what the write ticket would do. */
export interface TriageSummary {
    readonly total: number;
    readonly p0: readonly number[];
    readonly perBand: Readonly<
        Record<
            Band,
            {
                readonly hold: number;
                /** unprioritized today → this band */
                readonly gain: number;
                /** another band today → this band */
                readonly change: number;
                readonly unchanged: number;
            }
        >
    >;
    readonly perSource: Readonly<Record<BandSource, number>>;
    readonly residue: readonly {
        readonly number: number;
        readonly title: string;
        readonly board: BoardPriority | null;
    }[];
}

export function summarize(
    issues: readonly TriageIssue[],
    verdicts: ReadonlyMap<number, TriageVerdict>,
    board: Readonly<Record<number, BoardPriority>>
): TriageSummary {
    const perBand = Object.fromEntries(
        BANDS.map((b) => [b, { hold: 0, gain: 0, change: 0, unchanged: 0 }])
    ) as Record<
        Band,
        { hold: number; gain: number; change: number; unchanged: number }
    >;
    const perSource = { fiat: 0, cards: 0, edge: 0, parent: 0 };
    const p0: number[] = [];
    const residue: {
        number: number;
        title: string;
        board: BoardPriority | null;
    }[] = [];
    for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
        const v = verdicts.get(issue.number);
        if (v === undefined) continue;
        const now = board[issue.number];
        if (v.kind === "p0") {
            p0.push(issue.number);
            continue;
        }
        if (v.kind === "residue") {
            residue.push({
                number: issue.number,
                title: issue.title,
                board: now ?? null,
            });
            continue;
        }
        const row = perBand[v.band];
        row.hold++;
        perSource[v.source]++;
        if (now === undefined) row.gain++;
        else if (now === v.band) row.unchanged++;
        else row.change++;
    }
    return { total: issues.length, p0, perBand, perSource, residue };
}

/** One board value the write side sets: `from` is what the board holds today
 *  (`null` = unprioritized). */
export interface BandWrite {
    readonly number: number;
    readonly band: Band;
    readonly from: BoardPriority | null;
}

/**
 * The writes a `--write` run owes (issue #4055): ONLY the values that differ
 * from the board, so a re-run on unchanged inputs owes nothing — the GraphQL
 * pool is 5000 points an hour, shared with `queue:plan` and every session.
 *
 *   - `P0` is never written and never cleared: a `p0` verdict owes nothing,
 *     and an issue the board holds at `P0` is skipped even if a verdict says
 *     otherwise (belt and braces — `triage` already maps it to `p0`);
 *   - residue owes nothing — not `P3`, not a clear: the rule abstained, and
 *     whatever the owner set stays;
 *   - a band the board already holds owes nothing.
 */
export function planWrites(
    verdicts: ReadonlyMap<number, TriageVerdict>,
    board: Readonly<Record<number, BoardPriority>>
): BandWrite[] {
    const out: BandWrite[] = [];
    for (const [number, v] of verdicts) {
        if (v.kind !== "band") continue;
        const from = board[number] ?? null;
        if (from === "P0" || from === v.band) continue;
        out.push({ number, band: v.band, from });
    }
    return out.sort((a, b) => a.number - b.number);
}

/** `null` = dry run; otherwise the writes the run applied. */
export function renderReport(
    summary: TriageSummary,
    written: readonly BandWrite[] | null = null,
    cardsResidue: readonly CardsResidue[] = []
): string {
    const header =
        written === null
            ? `backlog:triage — DRY RUN, nothing written (the band rule of issue #3851 decision 3)`
            : `backlog:triage — WRITE: ${written.length} board value(s) written (` +
              BANDS.map(
                  (b) => `${b} ${written.filter((w) => w.band === b).length}`
              ).join(", ") +
              `; the band rule of issue #3851 decision 3)`;
    const lines = [
        header,
        `open issues: ${summary.total}`,
        `P0 untouched (hand-set, never written or cleared): ${summary.p0.length}` +
            (summary.p0.length > 0
                ? ` — ${summary.p0.map((n) => `#${n}`).join(", ")}`
                : ""),
        "",
        "band  would hold  gain (unprioritized →)  change (other band →)  unchanged",
    ];
    for (const band of BANDS) {
        const r = summary.perBand[band];
        lines.push(
            `${band}    ${String(r.hold).padStart(10)}  ${String(r.gain).padStart(22)}  ${String(r.change).padStart(21)}  ${String(r.unchanged).padStart(9)}`
        );
    }
    const s = summary.perSource;
    lines.push(
        "",
        `by source: fiat ${s.fiat}, cards ${s.cards}, edge ${s.edge}, parent ${s.parent}`,
        "",
        `residue (no source yields a band — stays unprioritized, the owner rules): ${summary.residue.length}` +
            ` (${summary.residue.filter((r) => r.board !== null).length} hold a board value today)`
    );
    for (const r of summary.residue)
        lines.push(
            `  #${r.number}${r.board === null ? "" : ` [board ${r.board}]`} ${r.title}`
        );
    lines.push(
        "",
        `## Cards residue (a declared line that bands nothing — fix the line): ${cardsResidue.length}`
    );
    for (const r of cardsResidue)
        lines.push(`  #${r.issue}  ${r.line}  — ${r.reason}`);
    return lines.join("\n");
}
