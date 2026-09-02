/**
 * The retirement ledger — the ONE input that turns a lockfile row into a
 * marked row (issue #3049, ADR 0114 §1).
 *
 * WHY A MARKER EXISTS AT ALL. Retiring a hand-written card in favour of its
 * proven-equal compiled twin leaves `data/oracle-compiled.json` as the only
 * copy of that card's behaviour. `git show <sha>:<path>` recovers the deleted
 * module forever, so recovery was never the problem — the problem is KNOWING
 * you need to recover. A lockfile row cannot say "I am the only copy", so a
 * diff touching a retired card's row reads exactly like a diff touching a card
 * that still has a hand-written twin to fall back on. The marker is what makes
 * the lockfile diff BE the log, rather than a separate log file duplicating
 * git with weaker guarantees (ADR 0114 § "git is already the log").
 *
 * WHY A LEDGER RATHER THAN A ROW EDIT. `data/oracle-compiled.json` is fully
 * regenerated from the corpus on every `bun run oracle:compile`, and it is
 * `LOCKFILE_GENERATOR`-stamped "never hand-edited". A marker written INTO the
 * artifact would be erased by the next regeneration — or would force the
 * generator to read its own previous output back in, which makes the file
 * self-referential and its determinism untestable. So provenance lives in a
 * small committed INPUT, and `buildLockfile` stamps it onto the row. The row
 * still carries the marker (that is what a reviewer reads in the diff); the
 * ledger is what a tool writes.
 *
 * The ledger is hashed into `header.compilerHash` (see
 * `compilerSourceFiles`), so editing it without regenerating reds
 * `bun run check:oracle` tier 1, offline, on a checkout with no corpus.
 *
 * FAIL-CLOSED, like everything else in the compiler (ADR 0105): an entry whose
 * `oracleId` is not in the corpus, or whose `name` disagrees with the corpus,
 * STOPS the compile. A typo'd oracle id would otherwise stamp nothing and
 * leave the author believing a card is marked when no row carries a marker —
 * the same "the author believes it is exempted and the guard never mentions
 * it" failure `compiler-gap-markers.ts` is strict to avoid.
 */

/** One retired hand-written card. Written by `bun run oracle:retire`. */
export interface RetirementEntry {
    /** Scryfall oracle id — the join key with the lockfile row and the corpus. */
    readonly oracleId: string;
    /** The card's name. Redundant with the corpus by construction (the
     *  compile asserts they agree), and kept because a name is what a human
     *  reads in a ledger diff and in a refusal message, where an opaque uuid
     *  is not. */
    readonly name: string;
    /** ISO calendar date the retirement landed, `YYYY-MM-DD`. */
    readonly retiredAt: string;
    /** The issue whose equivalence proof authorised the retirement. */
    readonly issue: number;
    /** The PR that landed it, when it is known at write time. */
    readonly pr?: number;
}

export interface RetirementLedger {
    readonly generator: string;
    /** Sorted by `oracleId`, so the file has exactly one serialization. */
    readonly retirements: readonly RetirementEntry[];
}

/** The marker as it appears ON the lockfile row. Deliberately narrower than
 *  the ledger entry: `oracleId` and `name` are already the row's own first two
 *  fields, and repeating them would let a row disagree with itself. */
export interface RetirementMarker {
    readonly at: string;
    readonly issue: number;
    readonly pr?: number;
}

export const RETIREMENT_LEDGER_PATH = "data/oracle-retirements.json";

export const RETIREMENT_LEDGER_GENERATOR =
    "written by `bun run oracle:retire` — never hand-edited (see docs/adr/0114-retiring-a-hand-written-card.md)";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every structural problem with a ledger, as reader-facing lines. Empty means
 * the ledger is well-formed.
 *
 * Returns ALL problems rather than throwing on the first: a ledger is edited
 * by tooling and read by a gate, and a gate that reports one problem per run
 * makes fixing three of them three runs.
 */
export function validateRetirementLedger(ledger: RetirementLedger): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    let previous: string | null = null;
    for (const entry of ledger.retirements) {
        const where = `${entry.name || "(unnamed)"} (${entry.oracleId || "no oracle id"})`;
        if (!entry.oracleId) problems.push(`${where}: missing oracleId`);
        if (!entry.name) problems.push(`${where}: missing name`);
        if (!ISO_DATE.test(entry.retiredAt ?? "")) {
            problems.push(
                `${where}: retiredAt must be a YYYY-MM-DD date, got ${JSON.stringify(entry.retiredAt)}`
            );
        }
        if (!Number.isInteger(entry.issue) || entry.issue <= 0) {
            problems.push(
                `${where}: issue must be a positive integer (the issue whose equivalence proof retired the card)`
            );
        }
        if (
            entry.pr !== undefined &&
            (!Number.isInteger(entry.pr) || entry.pr <= 0)
        ) {
            problems.push(
                `${where}: pr must be a positive integer when present`
            );
        }
        if (seen.has(entry.oracleId)) {
            problems.push(`${where}: duplicate oracleId`);
        }
        seen.add(entry.oracleId);
        // Sortedness is not cosmetic: it is what makes the serialization of a
        // given set of retirements unique, so two tools appending the same
        // entry produce the same bytes and the diff stays a one-line append.
        if (previous !== null && entry.oracleId < previous) {
            problems.push(
                `${where}: entries must be sorted by oracleId (this one follows ${previous})`
            );
        }
        previous = entry.oracleId;
    }
    return problems;
}

/** oracleId → the marker `buildLockfile` stamps onto that card's row. */
export function retirementMarkers(
    ledger: RetirementLedger
): Map<string, RetirementMarker> {
    const out = new Map<string, RetirementMarker>();
    for (const entry of ledger.retirements) {
        out.set(entry.oracleId, {
            at: entry.retiredAt,
            issue: entry.issue,
            ...(entry.pr === undefined ? {} : { pr: entry.pr }),
        });
    }
    return out;
}

/** An empty ledger — what the file holds before the first retirement, and the
 *  fallback a reader uses when the file is absent (a checkout predating it). */
export function emptyRetirementLedger(): RetirementLedger {
    return {
        generator: RETIREMENT_LEDGER_GENERATOR,
        retirements: [],
    };
}

export function parseRetirementLedger(text: string): RetirementLedger {
    const parsed = JSON.parse(text) as RetirementLedger;
    if (!Array.isArray(parsed.retirements)) {
        throw new Error(
            `${RETIREMENT_LEDGER_PATH}: no \`retirements\` array — the file is not a retirement ledger`
        );
    }
    return parsed;
}

/**
 * Deterministic serializer: entries sorted by oracleId, one per line, fixed
 * key order. Same discipline as `serializeLockfile` and for the same reason —
 * the file is committed so that a retirement shows up as a single added line
 * in review.
 */
export function serializeRetirementLedger(ledger: RetirementLedger): string {
    const rows = [...ledger.retirements]
        .sort((a, b) =>
            a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0
        )
        .map((e) =>
            JSON.stringify({
                oracleId: e.oracleId,
                name: e.name,
                retiredAt: e.retiredAt,
                issue: e.issue,
                ...(e.pr === undefined ? {} : { pr: e.pr }),
            })
        );
    const lines = ["{"];
    lines.push(`    "generator": ${JSON.stringify(ledger.generator)},`);
    lines.push(`    "retirements": [`);
    rows.forEach((row, i) => {
        lines.push(`        ${row}${i === rows.length - 1 ? "" : ","}`);
    });
    lines.push(`    ]`);
    lines.push("}");
    return lines.join("\n") + "\n";
}

/** Append `entry`, keeping the ledger sorted and rejecting a re-retirement of
 *  a card already in it (which would mean two provenances for one row). */
export function addRetirement(
    ledger: RetirementLedger,
    entry: RetirementEntry
): RetirementLedger {
    if (ledger.retirements.some((e) => e.oracleId === entry.oracleId)) {
        throw new Error(
            `${entry.name} (${entry.oracleId}) is already in ${RETIREMENT_LEDGER_PATH} — a card is retired once`
        );
    }
    return {
        generator: ledger.generator,
        retirements: [...ledger.retirements, entry].sort((a, b) =>
            a.oracleId < b.oracleId ? -1 : a.oracleId > b.oracleId ? 1 : 0
        ),
    };
}
