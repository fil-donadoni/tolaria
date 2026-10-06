// The Promotion streak ledger: per locked Verdict, how many consecutive
// Promotions it has stayed satisfied (issue #3985, PRD #3980, ADR 0138).
//
// WHY A LEDGER. The Verdict Lock holds only the current set
// (`lockSource.ts`), and a promotion's "pairs the fit could not satisfy" is
// printed, never kept — so "stayed satisfied across successive Weight Fits",
// the bar an Admission Candidate clears (CONTEXT.md § Admission), had nowhere
// to be read from. This file is that history, reduced to the one number the
// proposer reads: the length of each Verdict's current run.
//
// ONE WRITER. `verdicts:promote` advances it in the same act that writes the
// lock and the weights, and only a promotion that writes them does: a no-op
// promotion is not a Promotion, so it advances nothing. The proposer
// (`admission.ts`) reads the ledger and writes nothing.
//
// TIED TO ONE LOCK. The ledger names the pack hash of the lock it was advanced
// with. Read against any other lock — one written by hand, or by a promotion
// that did not write the ledger — it says nothing, and every streak restarts
// at zero: the direction that can only delay a proposal, never invent one.
// The reset is reported, never silent.
//
// SATISFIED MEANS NO PAIR VIOLATED. A verdict whose every pair is a timing
// pair (`evalPairs.ts`) gives the fit nothing to violate, so its streak grows
// with every Promotion: the fit cannot speak for it, and the proposer's seed
// check — the whole search, the one that answers for timing — is what does.
//
// Pure: no store, no clock, no file system.

import { VERDICT_HASH_PATTERN } from "./identity";
import { PACK_HASH_PATTERN, type VerdictLock } from "./lockSource";

/** Where the committed ledger lives, relative to the repo root — beside the
 *  lock it is advanced with. */
export const PROMOTION_STREAK_PATH = "data/verdicts.streaks.json";

export type PromotionStreakLedger = {
    /** The pack hash of the lock this ledger was advanced with. */
    packHash: string;
    /** Locked verdict id → consecutive Promotions it stayed satisfied, the
     *  current one included. Every id the lock names, `0` when the last
     *  Promotion left it unsatisfied. */
    streaks: Record<string, number>;
};

/** The streaks a reader may use against a lock, and why they were reset when
 *  they were. */
export type PromotionStreaks = {
    streaks: ReadonlyMap<string, number>;
    /** `null` when the ledger is the one advanced with this lock. */
    reset: string | null;
};

function bad(why: string): never {
    throw new Error(`${PROMOTION_STREAK_PATH}: ${why}`);
}

/** The ledger file's contents. Throws, naming the file, on anything else — a
 *  committed ledger that does not read is a broken checkout, never "no
 *  history". */
export function parsePromotionStreakLedger(
    contents: string
): PromotionStreakLedger {
    let raw: unknown;
    try {
        raw = JSON.parse(contents);
    } catch (error) {
        bad(
            `not valid JSON (${error instanceof Error ? error.message : `${error}`})`
        );
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        bad("must be a JSON object");
    }
    const { packHash, streaks } = raw as Record<string, unknown>;
    if (typeof packHash !== "string" || !PACK_HASH_PATTERN.test(packHash)) {
        bad(`"packHash" must be a sha256 hex digest`);
    }
    if (
        streaks === null ||
        typeof streaks !== "object" ||
        Array.isArray(streaks)
    ) {
        bad(`"streaks" must be an object`);
    }
    const out: Record<string, number> = {};
    for (const [id, count] of Object.entries(streaks)) {
        if (!VERDICT_HASH_PATTERN.test(id)) {
            bad(`"streaks" names ${JSON.stringify(id)}, not a verdict id`);
        }
        if (!Number.isInteger(count) || (count as number) < 0) {
            bad(`"streaks"["${id}"] must be a non-negative integer`);
        }
        out[id] = count as number;
    }
    return { packHash, streaks: out };
}

/** The ledger file's contents — ids sorted, one per line, so a promotion's
 *  diff shows exactly the streaks it moved. */
export function serializePromotionStreakLedger(
    ledger: PromotionStreakLedger
): string {
    const streaks = Object.fromEntries(
        Object.keys(ledger.streaks)
            .sort()
            .map((id) => [id, ledger.streaks[id]])
    );
    return `${JSON.stringify({ packHash: ledger.packHash, streaks }, null, 4)}\n`;
}

/** The streaks `ledger` holds for `lock`: its own when it was advanced with
 *  that lock, none (with the reason) otherwise. */
export function streaksOverLock(
    ledger: PromotionStreakLedger | null,
    lock: VerdictLock | null
): PromotionStreaks {
    if (ledger === null) {
        return {
            streaks: new Map(),
            reset:
                lock === null
                    ? null
                    : `no ${PROMOTION_STREAK_PATH} beside the committed lock — every streak starts at 0`,
        };
    }
    if (lock === null || ledger.packHash !== lock.packHash) {
        return {
            streaks: new Map(),
            reset: `${PROMOTION_STREAK_PATH} was advanced with pack ${ledger.packHash}, the committed lock is ${lock === null ? "absent" : `pack ${lock.packHash}`} — every streak restarts at 0`,
        };
    }
    return { streaks: new Map(Object.entries(ledger.streaks)), reset: null };
}

/**
 * The ledger a Promotion from `prior` to `next` writes: every verdict `next`
 * names gains one if the fit over `next` satisfies it (no id in
 * `unsatisfied`), and drops to zero otherwise. A verdict `next` no longer
 * names leaves the ledger — dropped from the lock, its run is over.
 */
export function advancePromotionStreaks(
    ledger: PromotionStreakLedger | null,
    prior: VerdictLock | null,
    next: VerdictLock,
    unsatisfied: ReadonlySet<string>
): { ledger: PromotionStreakLedger; reset: string | null } {
    const before = streaksOverLock(ledger, prior);
    const streaks: Record<string, number> = {};
    for (const id of next.verdictIds) {
        streaks[id] = unsatisfied.has(id)
            ? 0
            : (before.streaks.get(id) ?? 0) + 1;
    }
    return {
        ledger: { packHash: next.packHash, streaks },
        reset: before.reset,
    };
}
