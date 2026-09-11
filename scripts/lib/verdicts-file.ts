// A `verdicts` row as a file in `data/verdicts/` (issue #3402, PRD #3397).
//
// The lowering `bun run verdicts:pull` performs, as pure functions, so what it
// writes is asserted directly rather than through a subprocess and a
// deployment — the convention the rest of `scripts/` follows: every DECISION
// is a pure function, the plumbing around it is thin.
//
// IDEMPOTENCE IS THE WHOLE CONTRACT. The export runs whenever anyone feels
// like it, and its diff is what a reviewer reads to see which judgements
// arrived. So the same row must produce the same BYTES every time: a fixed key
// order (not insertion order, which follows whatever the query returned), a
// fixed indent, a trailing newline, and no clock anywhere — `createdAt` is the
// row's own stamp, converted, never `Date.now()`.
//
// It deliberately imports NOTHING from the blade module. A `scripts/*.ts`
// entry that reaches `convex/gre/ai/blade/**` drags `convex/game.ts` →
// `_generated/api` → `@auth/core` → `preact` → `lib.dom` into the scripts
// tsconfig project and reds an unrelated file; the type import below stops at
// `gre/ai/verdicts/types.ts`, whose own imports are type-only and reach no
// `_generated` module.
import type { Verdict } from "../../convex/gre/ai/verdicts/types";

/** Where the corpus lives, relative to the repo root. */
export const VERDICT_DIR = "data/verdicts";

/** The `verdicts:list` projection — what `convex/verdicts.ts`'s `list`
 *  returns, restated structurally rather than imported, because importing
 *  `_generated/api` from a script is the exact edge the header warns about. */
export type VerdictRow = {
    _id: string;
    spec: unknown;
    setup?: unknown;
    seat: "me" | "opp";
    candidates: { key: string; description: string }[];
    answer:
        | { kind: "right"; rightIndexes: number[] }
        | { kind: "forbidden"; forbiddenIndexes: number[] };
    botPickIndex?: number;
    gameId?: string;
    seq?: number;
    author: string;
    createdAt: number;
    note?: string;
};

/** The verdict id a row exports under.
 *
 *  The Convex document id, prefixed by the source — stable for the life of the
 *  row (Convex ids are never reused), unique without a counter, and readable
 *  as "this came from a game" beside a `registry:` id in a report. */
export function verdictIdOfRow(row: VerdictRow): string {
    return `in-play:${row._id}`;
}

/** The file one row is written to, relative to `VERDICT_DIR`. The document id
 *  alone: the `in-play:` prefix carries a colon, which is legal in a POSIX
 *  path but reads badly in a diff and is a trap on other filesystems. */
export function verdictFileNameOfRow(row: VerdictRow): string {
    return `${row._id}.json`;
}

/** One row as the `Verdict` the corpus reads back
 *  (`gre/ai/verdicts/fileSource.ts`). */
export function verdictFromRow(row: VerdictRow): Verdict {
    return {
        id: verdictIdOfRow(row),
        spec: row.spec as Verdict["spec"],
        ...(row.setup === undefined
            ? {}
            : { setup: row.setup as Verdict["setup"] }),
        seat: row.seat,
        candidates: row.candidates.map((c) => ({
            key: c.key,
            description: c.description,
        })),
        answer: row.answer,
        ...(row.botPickIndex === undefined
            ? {}
            : { botPickIndex: row.botPickIndex }),
        author: row.author,
        // The row's own stamp, in ISO 8601 — `Verdict.createdAt` is a string
        // so a file reads as a date in a diff instead of an epoch integer.
        createdAt: new Date(row.createdAt).toISOString(),
        source: "in-play",
        ...(row.gameId === undefined && row.seq === undefined
            ? {}
            : {
                  origin: {
                      ...(row.gameId === undefined
                          ? {}
                          : { gameId: row.gameId }),
                      ...(row.seq === undefined ? {} : { seq: row.seq }),
                  },
              }),
        ...(row.note === undefined ? {} : { note: row.note }),
    };
}

/** The key order every exported file uses — declaration order of `Verdict`,
 *  pinned here so the bytes cannot drift with however an object happened to be
 *  built. A key absent from the verdict is skipped, never written as `null`.
 *  `satisfies` ties it to the type: a field added to `Verdict` and forgotten
 *  here would otherwise be silently dropped from every export. */
const KEY_ORDER = [
    "id",
    "spec",
    "setup",
    "seat",
    "candidates",
    "answer",
    "botPickIndex",
    "author",
    "createdAt",
    "source",
    "origin",
    "note",
] as const satisfies readonly (keyof Verdict)[];

/** The exported file's exact bytes. Deterministic and idempotent: fixed key
 *  order, 4-space indent (the repo's `tabWidth`), trailing newline. */
export function serializeVerdict(verdict: Verdict): string {
    const ordered: Record<string, unknown> = {};
    for (const key of KEY_ORDER) {
        const value = (verdict as Record<string, unknown>)[key];
        if (value !== undefined) ordered[key] = value;
    }
    return `${JSON.stringify(ordered, null, 4)}\n`;
}

/** Every key of `Verdict` is written. A `satisfies` clause proves each listed
 *  key EXISTS on the type; this proves none is MISSING — the direction that
 *  loses data. Exported so the test asserts it against the type's own keys. */
export const VERDICT_KEY_ORDER: readonly (keyof Verdict)[] = KEY_ORDER;
