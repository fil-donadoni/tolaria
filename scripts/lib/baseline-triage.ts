/**
 * Guard C's baseline, TRIAGED BY DIRECTION OF DEFECT (issue #3050, ADR 0114 §5).
 *
 * ── Why a direction ────────────────────────────────────────────────────────
 *
 * A baseline row records one fact — "this hand-written card does not round-trip
 * through the Oracle compiler" — and the list's only stated property is that it
 * shrinks. But that one fact covers two OPPOSITE defects:
 *
 *   - the compiler cannot yet read the card. A grammar gap, whose fragment
 *     feeds the backlog PRD #2693 user story 9 ranks by corpus count.
 *   - the compiler reads it correctly and disagrees, AND THE COMPILER IS RIGHT.
 *     A defect in the hand-written card, which feeds a fix ticket.
 *
 * The second class is invisible inside the first, and it is not hypothetical:
 * Northern Paladin (#3046, a strictly weaker card than the printed one) and
 * Ashnod's Altar (#3047, a mana ability on the stack against CR 605.3b) were
 * both sitting in a list labelled, in effect, "the compiler can't read this
 * yet". A card bug parked in a compiler-gap list is a bug nobody is looking for.
 *
 * ── The direction is CHECKED, not decorative ───────────────────────────────
 *
 * A hand-typed label on 1,719 rows would rot the day a grammar slot shipped.
 * What keeps it honest is `DIRECTION_ALLOWED_KINDS` below: each direction
 * enumerates the LIVE `RoundTripVerdict` kinds that can support it, and
 * `triageBaseline` recomputes every row's verdict through the same single
 * comparator Guard C and the gold harness use (`roundTripCard`). A row whose
 * declared direction its verdict cannot support is an `inconsistent` row, and
 * Guard C reds on it.
 *
 * The table is one-to-one on two of the three kinds, and each entry is an
 * argument:
 *
 *   - `unparsed` supports ONLY `compiler-gap`. While the grammar refuses the
 *     card outright there is no compiled twin, so no claim about the
 *     hand-written side can be made from this comparison at all — not even
 *     "undetermined", because the direction IS determined: it is the compiler.
 *   - `no-oracle-text` supports ONLY `card-defect`. No grammar was involved:
 *     the definition is missing the compiler's input, which is a hole on the
 *     hand-written side (`docs/findings/2694-gold-cards-without-oracletext.md`).
 *   - `mismatch` supports ALL THREE, and that is the honest answer rather than
 *     a loose one. The compiler produced a definition and the two disagree;
 *     which side is wrong is a RULING, and all three outcomes are real. The
 *     compiler read the card wrongly (`compiler-gap` — issue #3050's own
 *     wording, "produced something the enumerated comparator says is not the
 *     card"); the compiler read it correctly and the card is wrong
 *     (`card-defect`); or nobody has decided (`undetermined`). Forbidding
 *     `mismatch` under `compiler-gap` would leave a genuine compiler MISREAD
 *     with no direction at all, forcing it to be filed as a card defect — the
 *     exact mirror of the bug this whole slice exists to kill.
 *
 * So state the limit plainly rather than overclaiming: on a `mismatch` this
 * table constrains NOTHING, and the label is only as good as the person who
 * wrote it. What stops that being decorative is not this file — it is
 * `convex/oracle/__tests__/gold.test.ts`, where `REPORT.mismatches` is asserted
 * EQUAL to the enumerated `KNOWN_DIVERGENCES`: a card that starts mismatching
 * cannot reach `main` without somebody writing down, in prose, which side is
 * wrong. This table's force is on the two kinds where no ruling is possible,
 * and there it is absolute — `unparsed` can only ever mean the compiler and
 * `no-oracle-text` can only ever mean the card, whatever anybody types.
 *
 * The one move it therefore still catches on its own: a tightening grammar that
 * turns an adjudicated `mismatch` back into `unparsed` reds every `card-defect`
 * and `undetermined` row it hits, because the evidence the ruling rested on —
 * the compiled twin — is gone, so the label is re-earned rather than
 * inherited.
 *
 * ── This module adds no normalisation axis, and must not ───────────────────
 *
 * ADR 0114 §4: the comparator's axes are enumerated and justified in
 * `convex/oracle/gold.ts`, and it never folds a field the engine reads to decide
 * (`useStack`, `cost`, `effects`, `targetRequirement`, `manaProduced`).
 * Triage classifies the verdicts that comparator already produces. Softening a
 * mismatch into a pass here would be phase.rs's failure mode wearing a
 * different hat.
 */

import type { CardDefinition } from "../../convex/cards/types";
import { roundTripCard, type RoundTripVerdict } from "../../convex/oracle/gold";

/**
 * Which side of the comparison the defect is on.
 *
 * `undetermined` is a legitimate terminal state for a row — but it is a QUEUE,
 * not a resting place. A row sits here when the compiler produced a definition,
 * the two disagree, and nobody has yet decided which encoding is canonical.
 */
export type BaselineDirection = "compiler-gap" | "card-defect" | "undetermined";

/** The three directions, in report order (dominant class first). */
export const BASELINE_DIRECTIONS: readonly BaselineDirection[] = [
    "compiler-gap",
    "card-defect",
    "undetermined",
];

/** One baseline row: the card's name plus the direction of its defect. */
export interface BaselineRow {
    readonly name: string;
    readonly direction: BaselineDirection;
}

/** A failing verdict's kind — the three `ok: false` kinds of `RoundTripVerdict`. */
export type FailingKind = Extract<RoundTripVerdict, { ok: false }>["kind"];

/**
 * The live verdict kinds each direction may rest on. See this file's header:
 * every entry is an argument, not a convenience. `mismatch` is the only kind
 * that leaves a choice to make — and the only one this table cannot police.
 */
export const DIRECTION_ALLOWED_KINDS: Readonly<
    Record<BaselineDirection, readonly FailingKind[]>
> = {
    "compiler-gap": ["unparsed", "mismatch"],
    "card-defect": ["no-oracle-text", "mismatch"],
    undetermined: ["mismatch"],
};

/** A baseline row that still describes something, with its live verdict. */
export interface TriagedRow {
    readonly name: string;
    readonly direction: BaselineDirection;
    readonly kind: FailingKind;
    /** The verdict's own one-clause explanation of what stopped the round-trip. */
    readonly detail: string;
    /** The two compared behavioural projections, present only for a
     *  `mismatch`. A `mismatch` verdict's `detail` carries the GOLD side alone,
     *  which is unreadable as a diff — and a mismatch is precisely the kind a
     *  person has to adjudicate, so the report needs both sides side by side or
     *  it cannot serve the one class it exists for. */
    readonly expected?: string;
    readonly actual?: string;
}

/** A row whose declared direction its live verdict cannot support. */
export interface InconsistentRow {
    readonly name: string;
    readonly direction: BaselineDirection;
    readonly kind: FailingKind;
}

export interface BaselineTriage {
    readonly counts: Readonly<Record<BaselineDirection, number>>;
    readonly byDirection: Readonly<
        Record<BaselineDirection, readonly TriagedRow[]>
    >;
    /** Rows the direction table forbids — Guard C's new assertion. */
    readonly inconsistent: readonly InconsistentRow[];
    /**
     * Rows that describe nothing any more: a name no card carries, or a card
     * that round-trips now. Reported so the script is self-contained; Guard C's
     * pre-existing stale-row assertion is what actually reds on them.
     */
    readonly stale: readonly string[];
    /** Rows that were classified — `total - stale.length`. */
    readonly total: number;
}

/**
 * Recompute every baseline row's verdict and sort it into its direction.
 *
 * Takes the rows as a parameter rather than importing the baseline: the data
 * lives with the guard it exempts (`convex/cards/__tests__/`), and a helper
 * reaching into a test directory to find it would invert the dependency for
 * nothing. Both callers — Guard C and `scripts/oracle-baseline-triage.ts` —
 * pass the same export, so the gate and the report can never disagree about
 * what a row's direction is, exactly as they cannot disagree about what
 * "round-trips" means.
 */
export function triageBaseline(
    cards: readonly CardDefinition[],
    rows: readonly BaselineRow[]
): BaselineTriage {
    const byName = new Map(cards.map((card) => [card.name, card] as const));
    const byDirection: Record<BaselineDirection, TriagedRow[]> = {
        "compiler-gap": [],
        "card-defect": [],
        undetermined: [],
    };
    const inconsistent: InconsistentRow[] = [];
    const stale: string[] = [];

    for (const row of rows) {
        const card = byName.get(row.name);
        if (card === undefined) {
            stale.push(`${row.name}: no such card (renamed or removed)`);
            continue;
        }
        const { verdict, expected, actual } = roundTripCard(card);
        if (verdict.ok) {
            stale.push(`${row.name}: round-trips now (${verdict.kind})`);
            continue;
        }
        byDirection[row.direction].push({
            name: row.name,
            direction: row.direction,
            kind: verdict.kind,
            detail: verdict.detail,
            ...(verdict.kind === "mismatch" ? { expected, actual } : {}),
        });
        if (!DIRECTION_ALLOWED_KINDS[row.direction].includes(verdict.kind)) {
            inconsistent.push({
                name: row.name,
                direction: row.direction,
                kind: verdict.kind,
            });
        }
    }

    return {
        counts: {
            "compiler-gap": byDirection["compiler-gap"].length,
            "card-defect": byDirection["card-defect"].length,
            undetermined: byDirection.undetermined.length,
        },
        byDirection,
        inconsistent,
        stale,
        total: rows.length - stale.length,
    };
}

/** One line per inconsistent row, for the guard's failure message. */
export function describeInconsistent(row: InconsistentRow): string {
    return (
        `${row.name}: declared "${row.direction}", but the compiler's verdict is ` +
        `"${row.kind}" — that direction accepts only ` +
        `${DIRECTION_ALLOWED_KINDS[row.direction].map((k) => `"${k}"`).join(" / ")}`
    );
}
