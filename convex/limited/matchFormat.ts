// The event's ROUND-MATCH configuration (PRD #1628 stories 1-4, ADR 0076,
// issue #1640): whether its round matches are best-of-one or best-of-three,
// and the bounds on the optional round deadline. Both are chosen once by the
// creator and fixed for the event's life.
//
// Pure and dependency-free (like the rest of `convex/limited/**`) — the create
// dialog, the mutation shell and the (later) round-Match builder all resolve
// the format and validate the deadline through this one module rather than
// each defaulting/bounding on their own, so the dialog's `min`/`max` can never
// drift from what the mutation actually accepts.

/** Best-of-N shape of every round Match in the event. */
export type LimitedMatchFormat = "bo1" | "bo3";

export const LIMITED_MATCH_FORMATS = ["bo1", "bo3"] as const;

/** PRD #1628 story 2: Bo3 is the default so an event plays like real Limited
 *  with nothing configured. Also the tolerant-read fallback for every event
 *  row written before the field existed (issue #1640: the stored field is
 *  OPTIONAL so pre-play-phase documents keep validating — see
 *  `resolveMatchFormat`). */
export const DEFAULT_MATCH_FORMAT: LimitedMatchFormat = "bo3";

/** The stored (optional) match format resolved to a definite one. The schema
 *  field is optional purely for backward compatibility with events created
 *  before the play phase existed; every READER goes through here, so the rest
 *  of the system — projection, wire shape, UI — only ever sees a concrete
 *  `"bo1" | "bo3"`, never `undefined`. */
export function resolveMatchFormat(
    stored: LimitedMatchFormat | undefined
): LimitedMatchFormat {
    return stored ?? DEFAULT_MATCH_FORMAT;
}

/** The `matches.bestOf` value a round Match of this format is created with —
 *  the seam between the event's own vocabulary and the existing Match/Game
 *  flow (`matches.bestOf: 1 | 3`, ADR 0029), so the round-pairing builder
 *  never hardcodes the mapping. */
export function bestOfForMatchFormat(format: LimitedMatchFormat): 1 | 3 {
    return format === "bo1" ? 1 : 3;
}

/** Games needed to WIN a match of this format — the score a bye is worth and
 *  the target the (later) bot-vs-bot simulator rolls towards. Bo1 = 1, Bo3 = 2
 *  (PRD #1628 story 28: "a bye recorded as a match win with the games it is
 *  worth"). */
export function gamesToWinMatch(format: LimitedMatchFormat): 1 | 2 {
    return format === "bo1" ? 1 : 2;
}

/** Round-deadline bounds in MINUTES (PRD #1628 story 3). The value is
 *  client-supplied, so `createLimitedEvent` range-checks it here rather than
 *  trusting an unbounded `v.number()` — a stored `NaN`/`Infinity`/negative
 *  would produce a `deadlineAt` that is either instantly expired or
 *  unreachable. The upper bound is one week: past that a "deadline" is not
 *  keeping the table moving, which is the only thing it exists to do. */
export const MIN_ROUND_DEADLINE_MINUTES = 1;
export const MAX_ROUND_DEADLINE_MINUTES = 7 * 24 * 60;

/** The default the create dialog offers once a deadline is switched on — a
 *  real Limited round length, not an arbitrary number. */
export const DEFAULT_ROUND_DEADLINE_MINUTES = 50;

/** Whether a client-supplied round deadline is storable. `undefined` (no
 *  deadline at all) is valid — story 4: a relaxed table is never cut short. */
export function isValidRoundDeadlineMinutes(minutes: number): boolean {
    return (
        Number.isInteger(minutes) &&
        minutes >= MIN_ROUND_DEADLINE_MINUTES &&
        minutes <= MAX_ROUND_DEADLINE_MINUTES
    );
}

/** Whether an arbitrary string is a valid Match Format — the parse boundary
 *  for a value arriving from outside the type system (a stored document, a
 *  client payload). */
export function isLimitedMatchFormat(
    value: string
): value is LimitedMatchFormat {
    return (LIMITED_MATCH_FORMATS as readonly string[]).includes(value);
}
