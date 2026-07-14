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
}

export interface LimitedEventView {
    _id: string;
    createdBy: string;
    type: LimitedEventType;
    status: LimitedEventStatus;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount?: number;
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
            };
        }),
    };
}
