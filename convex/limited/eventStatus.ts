// Limited Event lifecycle status — the single authority on what each phase of
// an event permits (PRD #1628, ADR 0076, issue #1640).
//
// ADR 0055 decision 1 stopped the event at the built Deck, so the union was
// two members (`open` → `started`) and every consumer could get away with a
// raw `status === "started"` comparison. PRD #1628 adds the PLAY PHASE, taking
// the union to four (`open` → `started` → `playing` → `finished`), and a raw
// comparison silently becomes a bug the moment a third member exists: the
// literal `!== "started"` guard on Auto-Build's pool-final check would have
// made every bot deck vanish the instant the event started its rounds.
//
// So the status is never compared literally outside this module. Every consumer
// asks a NAMED question (`arePoolsDealt`, `areDraftPicksLegal`, …) answered
// from ONE table, and that table is `satisfies Record<LimitedEventStatus, …>`
// — a fifth status is a COMPILE error listing exactly which facts it has to
// declare, not a silently-false predicate. Same discipline as the target-filter
// registry (ADR 0068): a missing entry must not typecheck.
//
// Pure and dependency-free, like the rest of `convex/limited/**` — the
// frontend imports it directly (ADR 0074: shared module, no shared authority).

/** Every Limited Event lifecycle status, in lifecycle order. The array is the
 *  source of the union so the exhaustiveness table below can key off it. */
export const LIMITED_EVENT_STATUSES = [
    // Filling Seats. No Pools exist yet.
    "open",
    // Draft / deckbuild phase: Pools are dealt (Sealed) or being drafted, and
    // seats build their one Limited-legal deck.
    "started",
    // Play phase (PRD #1628): the event's Swiss rounds are running. Pools and
    // decks are final; the only Match a seat plays is its round pairing.
    "playing",
    // Terminal: the last round is decided, standings are final, and free
    // (unrecorded) playtesting is available again.
    "finished",
] as const;

export type LimitedEventStatus = (typeof LIMITED_EVENT_STATUSES)[number];

/** What one status permits. Deliberately a small, closed fact set: every field
 *  answers a question a real consumer asks today, so adding a status forces a
 *  decision on each rather than inviting speculative flags. */
interface LimitedEventPhaseFacts {
    /** Seats can still be joined/left, and the event started or cancelled. */
    seatingOpen: boolean;
    /** Seat Pools have been generated — so a seat's Pool, its built deck and
     *  its Auto-Built bot deck all exist and are safe to read. True for every
     *  status after `open`: a Pool is never un-dealt. */
    poolsDealt: boolean;
    /** Draft Picks (`submitPick`, `selectDraftPick`, the Auto-Pick timeout)
     *  are legal. Only during the draft/deckbuild phase — once the rounds
     *  start, packs are long gone. */
    draftPicksLegal: boolean;
    /** The event's Swiss rounds are running: seats play their pairing, free
     *  challenges are withdrawn (PRD #1628 stories 36-37). */
    roundsRunning: boolean;
    /** Terminal: the standings are final and the event has a winner. */
    concluded: boolean;
}

const PHASE_FACTS = {
    open: {
        seatingOpen: true,
        poolsDealt: false,
        draftPicksLegal: false,
        roundsRunning: false,
        concluded: false,
    },
    started: {
        seatingOpen: false,
        poolsDealt: true,
        draftPicksLegal: true,
        roundsRunning: false,
        concluded: false,
    },
    playing: {
        seatingOpen: false,
        poolsDealt: true,
        draftPicksLegal: false,
        roundsRunning: true,
        concluded: false,
    },
    finished: {
        seatingOpen: false,
        poolsDealt: true,
        draftPicksLegal: false,
        roundsRunning: false,
        concluded: true,
    },
    // The `satisfies` is the guard: a new member of `LimitedEventStatus` with
    // no row here fails to compile, and the error names the facts it must
    // declare. Never widen this to `Record<string, …>`.
} as const satisfies Record<LimitedEventStatus, LimitedEventPhaseFacts>;

/** Seats can still be joined/left; the event can be started or cancelled. */
export function isSeatingOpen(status: LimitedEventStatus): boolean {
    return PHASE_FACTS[status].seatingOpen;
}

/** Seat Pools exist (and never un-exist) — the gate for reading a seat's Pool,
 *  its submitted deck, or its Auto-Built bot deck. */
export function arePoolsDealt(status: LimitedEventStatus): boolean {
    return PHASE_FACTS[status].poolsDealt;
}

/** Draft Picks are legal (draft/deckbuild phase only). */
export function areDraftPicksLegal(status: LimitedEventStatus): boolean {
    return PHASE_FACTS[status].draftPicksLegal;
}

/** The event's Swiss rounds are running (PRD #1628). */
export function areRoundsRunning(status: LimitedEventStatus): boolean {
    return PHASE_FACTS[status].roundsRunning;
}

/** The event is over: standings final, free playtesting back (unrecorded). */
export function isEventConcluded(status: LimitedEventStatus): boolean {
    return PHASE_FACTS[status].concluded;
}
