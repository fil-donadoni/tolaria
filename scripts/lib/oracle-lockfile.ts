/**
 * The Oracle lockfile — shape, hashing, and a deterministic serializer.
 *
 * Shared by `oracle-compile.ts` (writes it), `oracle-report.ts` (reads it) and
 * `check-oracle-lockfile.ts` (guards it), so there is exactly one definition of
 * what the file is.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
    EFFECT_OP_REGISTRY,
    MECHANICS_REGISTRY,
} from "../../convex/cards/mechanicsRegistry";
import type { BotReachOutcome } from "../../convex/gre/ai/botReach";
import type {
    Attribution,
    CompiledDefinition,
    CompileState,
    QuarantineReason,
} from "../../convex/oracle/types";
import type { CorpusPin, ReportedFormat } from "../oracle-corpus";
import {
    RETIREMENT_LEDGER_PATH,
    type RetirementMarker,
} from "./oracle-retirements";

/**
 * The header's three DERIVED hashes — the whole of the drift guard's offline
 * tier, and the only part of the header a clean checkout can re-derive.
 *
 * Named as its own type so the guard's comparison takes exactly these three:
 * adding a fourth reds every site that CONSTRUCTS one, which is what forces
 * the guard to learn to compute the tree's side of it. It does not force the
 * comparison itself — a hash added here and never compared in
 * `headerHashDrift` still type-checks, so that half stays on the author.
 * Issue #3068 shipped the third, and it went missing for so long because
 * nothing forced the header and the guard to agree at all.
 */
export interface HeaderHashes {
    /**
     * sha256 of every source file whose edit can change the bytes of this
     * lockfile: `convex/oracle/**` (non-test) plus the corpus reader, the
     * compile driver and this serializer.
     */
    readonly compilerHash: string;
    /** sha256 of the Mechanics Registry's names and statuses. */
    readonly registryHash: string;
    /**
     * sha256 of the POOL PROJECTION — the sorted set of non-compiled oracle
     * ids read from `data/card-index.json`, i.e. exactly the cards the
     * per-format `pool` figure counts.
     */
    readonly poolHash: string;
}

export interface LockfileHeader extends HeaderHashes {
    readonly grammarVersion: string;
    /**
     * The Bot hash the rows' `botReach` verdicts were played under (ADR 0105
     * § 7.2, issue #3830) — the second half of the sweep's cache key, never a
     * drift condition: see `lib/oracle-bot-reach.ts` for why it is NOT one of
     * the {@link HeaderHashes}.
     */
    readonly botHash: string;
    readonly corpus: CorpusPin;
    readonly counts: Record<CompileState, number> & { readonly total: number };
}

export interface FormatRow {
    readonly total: number;
    readonly ready: number;
    readonly quarantine: number;
    readonly unparsed: number;
    /** Cards of this format covered by a HAND-WRITTEN definition today. */
    readonly pool: number;
}

/** A distinct unconsumed fragment and how many cards it blocks. */
export interface FragmentRow {
    /**
     * The fragment's Fragment Key ({@link fragmentKey}) — what a card row's
     * `gaps` cite it by (issue #6169). Derived from the three fields below,
     * never from the row's place in the table.
     */
    readonly key: string;
    readonly text: string;
    readonly reason: string;
    readonly cards: number;
    /**
     * Which slot and sub-grammar refused the line, and the span it could not
     * consume (issue #3822) — what `oracle:report` attributes the fragment to
     * a Grammar Gap by. Absent exactly when the compiler's `Gap` carries none.
     */
    readonly attribution?: Attribution;
}

/**
 * A Bot Gap (ADR 0105 § 7.2, issue #3830): one form a card fails the Bot-play
 * sweep by, and how many cards fail it that way — ranked like
 * {@link FragmentRow}, blast radius first.
 */
export interface BotGapRow {
    /** `<cause> › <form>`, plus `› <ops>` for a `never-chosen` card. */
    readonly key: string;
    /** `ignored` ships the cards; `frozen` withholds them. */
    readonly outcome: BotReachOutcome;
    readonly cards: number;
}

export interface CardRow {
    readonly oracleId: string;
    readonly name: string;
    readonly state: CompileState;
    /**
     * The formats whose card pool holds this card — the corpus's `poolIn`
     * (legal, banned or restricted), omitted when empty. Carried so a format
     * pool can be a Grammar Gap ranking Target (issue #3822) from the
     * lockfile alone, which is the report's contract: no corpus, no network.
     */
    readonly poolIn?: readonly ReportedFormat[];
    /**
     * The Fragment Keys of the lines the card fails on, sorted — resolved
     * through {@link indexFragments}, never by position. Present iff
     * `state === "unparsed"`.
     */
    readonly gaps?: readonly string[];
    readonly slots?: readonly string[];
    readonly opsUsed?: readonly string[];
    readonly quarantineReasons?: readonly QuarantineReason[];
    readonly definition?: CompiledDefinition;
    /**
     * The Bot-play verdict (ADR 0105 § 7.2, issue #3830) — present iff the
     * card compiled `ready` before the sweep. A `frozen` card is then
     * `quarantine` with reason `bot-unreachable`; `played` and `ignored` stay
     * `ready`. Carried forward from the previous lockfile while the
     * definition and the Bot are unchanged (`lib/oracle-bot-reach.ts`).
     */
    readonly botReach?: BotReachOutcome;
    /** The Bot Gap key the card counts toward — present iff `botReach` is
     *  not `played`. */
    readonly botGap?: string;
    /**
     * Present iff this card's hand-written definition has been RETIRED
     * (issue #3049, ADR 0114 §1) — this row is then the only copy of the
     * card's behaviour, and a diff touching it is a behaviour change with no
     * hand-written twin to fall back on.
     *
     * Stamped from `data/oracle-retirements.json` by `buildLockfile`, never
     * hand-written into this file (the whole file is regenerated, so a
     * hand-edit here does not survive the next `oracle:compile` — see
     * `lib/oracle-retirements.ts` for why provenance lives in an input).
     * Always the LAST key of the row, so marking a card changes exactly one
     * row and nothing about the rest of the file's bytes.
     *
     * Provenance is on the LOCKFILE, never on the served asset: ADR 0114 §2
     * keeps `data/oracle-compiled-pool.json` a resolved catalogue with nothing
     * left to resolve at runtime, and a marker is read by review, not by the
     * engine.
     */
    readonly retired?: RetirementMarker;
}

export interface Lockfile {
    readonly generator: string;
    readonly header: LockfileHeader;
    readonly formats: Record<ReportedFormat, FormatRow>;
    readonly fragments: readonly FragmentRow[];
    /** The Bot Gap table (ADR 0105 § 7.2), ranked. */
    readonly botGaps: readonly BotGapRow[];
    readonly cards: readonly CardRow[];
}

export const LOCKFILE_GENERATOR =
    "generated by `bun run oracle:compile` — never hand-edited (see docs/adr/0105-oracle-compiler-fail-closed.md)";

const ORACLE_MODULE_DIR = "convex/oracle";

/**
 * The DRIVER half of the compiler: files outside `convex/oracle/**` that still
 * decide what the lockfile says.
 *
 * `oracle-corpus.ts` shapes every input row and names the reported formats,
 * `oracle-compile.ts` builds the fragment table and the per-format tallies, and
 * this file serializes the result. An edit to any of them changes the output
 * with the grammar untouched — so hashing the grammar alone left tier 1 green
 * on a lockfile it should have rejected, which is the same "guard that is not
 * there" shape the tiering exists to avoid (review of #2795, round 2).
 */
const DRIVER_FILES = [
    "scripts/oracle-corpus.ts",
    "scripts/oracle-compile.ts",
    "scripts/lib/oracle-lockfile.ts",
    // The Bot Gap key and table (issue #3830) — rendered into this file.
    "scripts/lib/oracle-bot-reach.ts",
    // The one CATALOGUE module a lowering value-imports (issue #4137):
    // `lowerEffects.ts` builds every "becomes the color of your choice" script
    // by calling `chooseColorEffects`, so that function's body — the mode
    // order, each mode's `id`/`label`/`color`, the `setColor` field set — is
    // baked into every compiled definition the colour rule emits. Reordering
    // the five modes there changes the lockfile's bytes while nothing under
    // `convex/oracle/**` moves, and tier 1 (the only tier that runs on a clean
    // checkout, where the 24 MB corpus is absent) would stay green on a stale
    // file. Same reason the driver files above are here, and the same reason
    // the Mechanics Registry has `registryHash`.
    "convex/cards/abilities/chooseColor.ts",
    // The SECOND such module (issue #4138) — `lowerEffects.ts` builds every
    // "becomes <basic land type> until …" script by calling
    // `landTypeChangeEffects`, so the mode order, each mode's `id`/`label`
    // and the one-type case's missing `optionChoice` wrapper are baked into
    // every compiled definition the land-type rule emits, for the same reason
    // and with the same staleness hazard as the colour builder above.
    "convex/cards/abilities/chooseLandType.ts",
] as const;

/**
 * Committed INPUTS that are not compiler source but still decide the
 * lockfile's bytes.
 *
 * The retirement ledger (issue #3049) is stamped onto rows by `buildLockfile`,
 * so editing it without regenerating leaves the lockfile stale in exactly the
 * way tier 1 exists to catch — and tier 1 is the only tier that runs on a
 * clean checkout, where the corpus is gitignored and absent. Leaving it out of
 * the hash would make "add a retirement, forget to compile" invisible offline,
 * which is the same "guard that is not there" shape that put the driver files
 * above into this hash (review of #2795, round 2).
 */
const DATA_INPUT_FILES = [RETIREMENT_LEDGER_PATH] as const;

/**
 * The card index, read as the POOL PROJECTION and hashed as
 * {@link poolHash} — not as a file in {@link DATA_INPUT_FILES}.
 *
 * It is an input to the lockfile like the ledger is, but only through one
 * derived value: the set of oracle ids a hand-written definition covers, which
 * is what the per-format `pool` figure counts. Hashing the whole FILE would
 * red on changes that cannot move a `pool` figure — the compiler's own
 * `source: "compiled"` rows, a `firstPrintId` correction — and the only way to
 * clear that red is a corpus download for a lockfile whose bytes would not
 * change, which is exactly the unsatisfiable-offline red the tiering exists to
 * avoid (issue #3068).
 */
export const POOL_PROJECTION_SOURCE = "data/card-index.json";

/**
 * The files {@link compilerHash} covers, as ONE reader-facing line, derived
 * from the two lists above.
 *
 * The drift message used to hand-type this list, and the retirement ledger was
 * added to the hash without being added to the sentence — so the one red a
 * ledger edit causes named only the compiler sources, and the reader had no
 * way to connect it to the file they had just edited. A list that CAN be
 * derived is not a sentence someone maintains.
 *
 * {@link POOL_PROJECTION_SOURCE} is deliberately NOT here: it reaches the
 * lockfile through a different hash, so a compiler-hash red can never be the
 * card index and listing it would send the reader to a file they did not
 * touch. Every input a reader could have edited is still named in the red it
 * causes — by the tier that owns it (issue #3068).
 */
export const LOCKFILE_INPUT_SUMMARY = [
    `${ORACLE_MODULE_DIR}/**`,
    ...DRIVER_FILES,
    ...DATA_INPUT_FILES,
].join(", ");

/** Every file the lockfile's contents depend on, in a stable order. */
export function compilerSourceFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(root, dir)).sort()) {
            const rel = `${dir}/${entry}`;
            if (statSync(join(root, rel)).isDirectory()) {
                if (entry === "__tests__") continue;
                walk(rel);
            } else if (entry.endsWith(".ts")) {
                out.push(rel);
            }
        }
    };
    walk(ORACLE_MODULE_DIR);
    out.push(...DRIVER_FILES);
    out.push(...DATA_INPUT_FILES);
    return out;
}

/**
 * Hash of the compiler's own source — grammar AND driver — plus the committed
 * data inputs in {@link DATA_INPUT_FILES}.
 *
 * This is what makes the drift guard work OFFLINE. The full regenerate-and-diff
 * needs the 24 MB corpus, which is gitignored and absent on a clean checkout;
 * the gate is offline by contract (CLAUDE.md). Hashing the sources catches the
 * case that actually happens — someone changed the compiler and did not
 * regenerate — without any network at all.
 *
 * It has to cover the driver as well as the grammar, and the clean checkout is
 * precisely where that bites: with only `convex/oracle/**` hashed, a change to
 * `buildLockfile` that genuinely alters the output left tier 1 passing and tier
 * 3 unable to run, so `check:oracle` exited 0 on a stale lockfile.
 */
export function compilerHash(root: string): string {
    const hash = createHash("sha256");
    for (const file of compilerSourceFiles(root)) {
        hash.update(file);
        hash.update(readFileSync(join(root, file)));
    }
    return `sha256:${hash.digest("hex")}`;
}

/**
 * Hash of the Mechanics Registry's NAMES and STATUSES — the two things that
 * change what the compiler emits and what it lets through the `ready` gate. A
 * keyword flipped from `planned` to `implemented` moves cards between states,
 * so it must invalidate the lockfile exactly like a grammar edit.
 */
export function registryHash(): string {
    const mechanics = MECHANICS_REGISTRY.map((r) => [
        r.id,
        r.name,
        r.kind,
        r.status,
    ]);
    const ops = EFFECT_OP_REGISTRY.map((r) => [r.op, r.status]);
    return `sha256:${createHash("sha256").update(JSON.stringify({ mechanics, ops })).digest("hex")}`;
}

/**
 * Hash of the POOL PROJECTION — the sorted set of oracle ids the card index
 * covers with a hand-written definition, which is exactly what the per-format
 * `pool` figure counts.
 *
 * Without it the card index was the one lockfile input no offline tier saw
 * (issue #3068): shipping a card moved the true `pool` while the committed
 * lockfile kept the old number, tiers 1 and 2 stayed green, and only the
 * corpus-dependent tier 3 noticed — on a machine that happened to have the
 * 24 MB gitignored cache. So the drift merged, and the next person with a
 * corpus paid for it as a conflict in a generated file they never touched.
 *
 * The caller passes the set, never a path: it is computed by the SAME exported
 * helper the compiler uses (`poolOracleIdsFromIndex`), so the guard and the
 * compiler cannot disagree about what the pool is.
 *
 * Sorted, because a `Set`'s iteration order is insertion order — hashing it
 * raw would make the hash depend on the card index's row order rather than on
 * its membership, and a pure reordering would then red a lockfile whose bytes
 * do not change.
 *
 * LENGTH-PREFIXED rather than separator-joined, so the framing is injective
 * for any id at all. A plain `id + "\n"` join collides on ids that contain the
 * separator — `{"a\nb", "c"}` and `{"a", "b\nc"}` both serialize to
 * `a\nb\nc\n` — which no Scryfall UUID can trigger today, but a hash whose
 * whole job is to fail closed should not rest on an assumption about its
 * input's alphabet (review of PR #3070).
 */
export function poolHash(poolOracleIds: ReadonlySet<string>): string {
    const hash = createHash("sha256");
    for (const id of [...poolOracleIds].sort()) {
        hash.update(`${id.length}:${id}`);
    }
    return `sha256:${hash.digest("hex")}`;
}

/**
 * Deterministic serializer.
 *
 * `JSON.stringify(x, null, 4)` would already be deterministic, but it puts a
 * 38,000-element array on 400,000 lines and makes every regeneration an
 * unreadable diff. One row per line keeps the file diffable — the point of
 * committing it at all is that a card moving `ready` → `unparsed` shows up as a
 * single changed line in review (PRD #2693 user stories 28/29).
 */
export function serializeLockfile(lock: Lockfile): string {
    const lines: string[] = ["{"];
    lines.push(`    "generator": ${JSON.stringify(lock.generator)},`);
    lines.push(
        `    "header": ${indentBlock(JSON.stringify(lock.header, null, 4), 4)},`
    );
    lines.push(
        `    "formats": ${indentBlock(JSON.stringify(lock.formats, null, 4), 4)},`
    );
    lines.push(`    "fragments": [`);
    lines.push(...rowsOf(lock.fragments));
    lines.push(`    ],`);
    lines.push(`    "botGaps": [`);
    lines.push(...rowsOf(lock.botGaps));
    lines.push(`    ],`);
    lines.push(`    "cards": [`);
    lines.push(...rowsOf(lock.cards));
    lines.push(`    ]`);
    lines.push("}");
    return lines.join("\n") + "\n";
}

/**
 * One row per line, indented and comma-separated — the shape that keeps a
 * 38,000-row array diffable. Exported because the Bot Reach Findings artifact
 * (`lib/oracle-bot-reach.ts`, ADR 0141 §4) is serialized the same way, and a
 * second copy of the formatting is a second file's bytes to keep in step.
 */
export function rowsOf(rows: readonly unknown[]): string[] {
    return rows.map(
        (row, i) =>
            `        ${JSON.stringify(row)}${i === rows.length - 1 ? "" : ","}`
    );
}

/** Re-indent a `JSON.stringify(x, null, 4)` block that starts mid-line. */
export function indentBlock(text: string, spaces: number): string {
    const pad = " ".repeat(spaces);
    return text
        .split("\n")
        .map((line, i) => (i === 0 ? line : pad + line))
        .join("\n");
}

export function parseLockfile(text: string): Lockfile {
    return JSON.parse(text) as Lockfile;
}

/** Whether a parsed value has the lockfile's shape — tables and counts. */
export function isLockfileShaped(value: unknown): value is Lockfile {
    const lock = value as Partial<Lockfile> | null;
    return (
        Array.isArray(lock?.fragments) &&
        Array.isArray(lock?.cards) &&
        lock?.header?.counts !== undefined
    );
}

// ── Fragment Keys (issue #6169) ─────────────────────────────────────────
//
// A card row cites the lines it fails on by a key derived from each
// fragment's own content, and the table is sorted by that content. A fragment
// entering or leaving the table then changes its own row and the rows of the
// cards that carry it, nothing else. Cited by INDEX, the 3 cards PR #6138
// took to `ready` renumbered 17,522 rows, so any two grammar PRs conflicted,
// and a clean textual merge could pair one side's indices with the other
// side's table.

/** What a fragment IS — the fields its key and its table position read. */
export type FragmentContent = Pick<FragmentRow, "text" | "reason"> & {
    readonly attribution?: Attribution;
};

/**
 * Hex digits of sha256 a Fragment Key keeps. 48 bits over ~31,000 fragments
 * puts a collision near 1 in 600,000; `oracle:compile` refuses one rather
 * than merge two fragments, and lengthening the key is the fix.
 */
export const FRAGMENT_KEY_HEX = 12;

/** An attribution as one intern/sort key — `""` when there is none. */
export function attributionKey(attribution: Attribution | undefined): string {
    return attribution === undefined
        ? ""
        : [attribution.slot, ...attribution.path, attribution.span].join(
              "\u0001"
          );
}

/**
 * The fragment's whole identity as one string — what the compiler dedupes
 * by, so two cards failing on the same line at the same place share a row.
 *
 * U+0000 as the join: it cannot occur in Oracle text, so the key is
 * unambiguous. Escaped rather than literal — a raw control byte in source
 * makes the whole FILE binary to git and grep.
 *
 * The attribution is part of it: the same line can fail at a different place
 * on a different card (the slot guards read the type line), and folding the
 * two would credit one card's gap to the other.
 */
export function fragmentIdentity(fragment: FragmentContent): string {
    return `${fragment.text}\u0000${fragment.reason}\u0000${attributionKey(fragment.attribution)}`;
}

/** The Fragment Key: the head of sha256 over {@link fragmentIdentity}. */
export function fragmentKey(fragment: FragmentContent): string {
    return createHash("sha256")
        .update(fragmentIdentity(fragment))
        .digest("hex")
        .slice(0, FRAGMENT_KEY_HEX);
}

/** A fragment row, its key derived — the one place a row is shaped. */
export function fragmentRow(
    fragment: FragmentContent & { readonly cards: number },
    key: string = fragmentKey(fragment)
): FragmentRow {
    return {
        key,
        text: fragment.text,
        reason: fragment.reason,
        cards: fragment.cards,
        ...(fragment.attribution !== undefined
            ? { attribution: fragment.attribution }
            : {}),
    };
}

const cmpString = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;

/**
 * The TABLE order: text, then reason, then attribution — the whole
 * identity, so the order is total, and content only, so a fragment's `cards`
 * moving never moves its line.
 */
export function compareFragmentContent(
    a: FragmentContent,
    b: FragmentContent
): number {
    return (
        cmpString(a.text, b.text) ||
        cmpString(a.reason, b.reason) ||
        cmpString(attributionKey(a.attribution), attributionKey(b.attribution))
    );
}

/**
 * The RANK order: blast radius first, the table order breaking ties — the
 * backlog that ranks the next grammar rule (PRD #2693 user story 9), and the
 * order in which a reader meets a card's fragments.
 */
export function compareFragmentRank(a: FragmentRow, b: FragmentRow): number {
    return b.cards - a.cards || compareFragmentContent(a, b);
}

/** The one way a reader resolves `gaps` (issue #6169). */
export interface FragmentIndex {
    /** Every fragment, in {@link compareFragmentRank} order. */
    readonly ranked: readonly FragmentRow[];
    /** The fragments a card's `gaps` cite, in rank order — so a reader
     *  taking a card's FIRST fragment takes its widest-blocking one. */
    readonly of: (card: CardRow) => readonly FragmentRow[];
}

/**
 * Index a lockfile's fragments by key. Throws on a duplicate key and on a
 * `gaps` key the table does not hold: either is a lockfile no reader can
 * trust (a hand-edit, a bad merge), and a reader guessing past it would
 * misattribute a card silently.
 */
export function indexFragments(
    lock: Pick<Lockfile, "fragments">
): FragmentIndex {
    const ranked = [...lock.fragments].sort(compareFragmentRank);
    const rank = new Map<string, number>();
    ranked.forEach((fragment, i) => {
        if (rank.has(fragment.key))
            throw new Error(
                `oracle lockfile: fragment key ${fragment.key} is on two rows — run: bun run oracle:compile`
            );
        rank.set(fragment.key, i);
    });
    const of = (card: CardRow): FragmentRow[] =>
        (card.gaps ?? [])
            .map((key) => {
                const i = rank.get(key);
                if (i === undefined)
                    throw new Error(
                        `oracle lockfile: ${card.name} cites fragment ${key}, which the table does not hold — run: bun run oracle:compile`
                    );
                return i;
            })
            .sort((a, b) => a - b)
            .map((i) => ranked[i]!);
    return { ranked, of };
}

/**
 * Everything a lockfile must satisfy on its own, with no corpus: each key is
 * its row's content key, the table and the rows are in canonical order, each
 * row's `gaps` resolve, each fragment declares exactly the cards citing it,
 * and the header counts agree with the rows.
 *
 * `check:oracle` runs it on every checkout. It is also what tells a CORRECT
 * clean textual merge from a wrong one: two branches each moving one card
 * onto the same fragment edit its `cards` identically, git keeps one edit,
 * and the count is one short.
 */
export function lockfileStructureProblems(
    lock: Pick<Lockfile, "header" | "fragments" | "cards">
): string[] {
    const problems: string[] = [];
    const declared = new Map<string, number>();
    lock.fragments.forEach((fragment, i) => {
        const key = fragmentKey(fragment);
        if (fragment.key !== key)
            problems.push(
                `fragment ${JSON.stringify(fragment.text)} carries key ${fragment.key}, its content's key is ${key}`
            );
        if (declared.has(fragment.key))
            problems.push(`fragment key ${fragment.key} is on two rows`);
        declared.set(fragment.key, fragment.cards);
        const prev = lock.fragments[i - 1];
        if (prev !== undefined && compareFragmentContent(prev, fragment) >= 0)
            problems.push(
                `fragment ${fragment.key} is out of table order (text, reason, attribution)`
            );
    });
    const cited = new Map<string, number>();
    const counts = { ready: 0, quarantine: 0, unparsed: 0 };
    lock.cards.forEach((card, i) => {
        counts[card.state] += 1;
        const prev = lock.cards[i - 1];
        if (prev !== undefined && prev.oracleId >= card.oracleId)
            problems.push(
                `card ${card.name} is out of oracle-id order or duplicated`
            );
        const gaps = card.gaps ?? [];
        if ((card.state === "unparsed") !== gaps.length > 0)
            problems.push(
                `card ${card.name} is ${card.state} with ${gaps.length} gap(s)`
            );
        gaps.forEach((key, j) => {
            if (j > 0 && gaps[j - 1]! >= key)
                problems.push(
                    `card ${card.name}'s gaps are not sorted and distinct`
                );
            if (!declared.has(key))
                problems.push(
                    `card ${card.name} cites fragment ${key}, which the table does not hold`
                );
            cited.set(key, (cited.get(key) ?? 0) + 1);
        });
    });
    for (const [key, cards] of declared) {
        const actual = cited.get(key) ?? 0;
        if (cards !== actual)
            problems.push(
                `fragment ${key} declares ${cards} card(s), ${actual} cite it`
            );
    }
    const header = lock.header.counts;
    for (const state of ["ready", "quarantine", "unparsed"] as const)
        if (header[state] !== counts[state])
            problems.push(
                `header counts ${header[state]} ${state}, the rows ${counts[state]}`
            );
    if (header.total !== lock.cards.length)
        problems.push(
            `header counts ${header.total} cards, the table holds ${lock.cards.length}`
        );
    return problems;
}
