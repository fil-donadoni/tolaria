// Event projection (PRD #1107, ADR 0054/0055, issue #1110): the privacy
// boundary between the authoritative `limitedEvents` row — which carries
// every seat's full Pool — and what a given viewer is allowed to see over the
// wire. Mirrors the discipline of `convex/gameProjections.ts`'s
// `projectPublicState`: a PURE function of (row, viewer), unit-testable
// without spinning up Convex, so "other seats' Pools are hidden during the
// event" is asserted through the SAME seam the client actually receives —
// never a hand-built view (the project's known recurring bug class, see
// `.claude/rules/gre-development.md` § Frontend wiring analysis).
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedEventStatus,
    LimitedEventType,
    LimitedPoolCard,
} from "./eventTypes";

/** The row shape this module projects — structurally what a `limitedEvents`
 *  Doc satisfies, kept independent of `Doc<"limitedEvents">` so this stays
 *  testable with plain fixtures (no `_generated` import needed). */
export interface LimitedEventRow {
    _id: string;
    createdBy: string;
    type: LimitedEventType;
    status: LimitedEventStatus;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount?: number;
    draftRound?: number;
    draftPacksRemaining?: number;
    draftCompletedAt?: number;
    /** Per-pick timer, seconds (issue #1114, PRD #1107 story 5) — absent ===
     *  disabled. Not per-seat: it's the event-wide config, always visible
     *  (not hidden information) so every seat's UI knows whether a countdown
     *  should render at all. */
    timerSeconds?: number;
    seats: LimitedEventSeat[];
    createdAt: number;
    updatedAt: number;
}

export interface LimitedEventSeatView {
    seatIndex: number;
    userId?: string;
    nickname?: string;
    isBot: boolean;
    /** True when this seat belongs to the viewer — drives which seat's `pool`
     *  is populated below. */
    isViewer: boolean;
    /** Number of cards in this seat's Pool, always visible once generated —
     *  so a player can see the table opened boosters — `null` before
     *  `startLimitedEvent` runs. */
    poolCount: number | null;
    /** Full Pool contents. Populated ONLY for the viewer's own seat; every
     *  other seat's Pool is stripped here (PRD #1107 story 15: "my picks
     *  hidden from other Seats during the draft" — the same discipline
     *  extends to a Sealed seat's opened boosters). */
    pool: LimitedPoolCard[] | null;
    /** Draft only: the pack currently in front of THIS seat. Populated ONLY
     *  for the viewer's own seat — another seat's current pack is exactly
     *  the hidden information a Draft protects (PRD #1107 story 15). `null`
     *  for a Sealed event, before the draft starts, or a non-viewer seat. */
    currentPack: DraftPackCard[] | null;
    /** Draft only: how many packs are queued behind `currentPack` — viewer's
     *  own seat only (never another seat's, and never a queued pack's
     *  contents, only the count). `null` when not applicable/not the
     *  viewer. */
    packQueueCount: number | null;
    /** Draft only, timer-on events (issue #1114): epoch ms when this seat's
     *  CURRENT `currentPack` pick times out, so the UI can render a live
     *  countdown (`Date.now()` diffed client-side, never a server-ticking
     *  integer). Same "own seat only" discipline as `currentPack` — another
     *  seat's timing is no more the viewer's business than their cards.
     *  `null` when not applicable/not the viewer/no timer configured. */
    pickDeadline: number | null;
}

export interface LimitedEventView {
    _id: string;
    createdBy: string;
    type: LimitedEventType;
    status: LimitedEventStatus;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount?: number;
    draftRound?: number;
    draftPacksRemaining?: number;
    draftCompletedAt?: number;
    timerSeconds?: number;
    seats: LimitedEventSeatView[];
    createdAt: number;
    updatedAt: number;
}

/** Projects a `limitedEvents` row for `viewerUserId` (`null` for an
 *  unauthenticated/anonymous read, which the lobby list never actually issues
 *  since every route requires login — kept for a defensive default). */
export function projectLimitedEvent(
    event: LimitedEventRow,
    viewerUserId: string | null
): LimitedEventView {
    return {
        _id: event._id,
        createdBy: event.createdBy,
        type: event.type,
        status: event.status,
        seatCount: event.seatCount,
        packSlots: event.packSlots,
        sealedBoosterCount: event.sealedBoosterCount,
        draftRound: event.draftRound,
        draftPacksRemaining: event.draftPacksRemaining,
        draftCompletedAt: event.draftCompletedAt,
        timerSeconds: event.timerSeconds,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        seats: event.seats.map((seat) => {
            const isViewer =
                viewerUserId !== null && seat.userId === viewerUserId;
            return {
                seatIndex: seat.seatIndex,
                userId: seat.userId,
                nickname: seat.nickname,
                isBot: seat.isBot ?? false,
                isViewer,
                poolCount: seat.pool ? seat.pool.length : null,
                pool: isViewer ? (seat.pool ?? null) : null,
                currentPack: isViewer ? (seat.currentPack ?? null) : null,
                packQueueCount: isViewer ? (seat.packQueue?.length ?? 0) : null,
                pickDeadline: isViewer ? (seat.pickDeadline ?? null) : null,
            };
        }),
    };
}
