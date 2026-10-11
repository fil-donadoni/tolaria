import { passDirection } from "@convex/limited/draftEngine";
import { isEventConcluded } from "@convex/limited/eventStatus";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import {
    limitedEventStatusHint,
    type LimitedEventStatusHint,
} from "~/lib/limitedEventStatus";

/** One seat's spot on the ring, as percentages of the ring box (x right, y
 *  down), so the layout scales with its container. */
export interface RingSlot {
    seatIndex: number;
    x: number;
    y: number;
}

/** A pass-direction arrow between two neighbouring seats: position at the
 *  midpoint, `rotation` in degrees for an arrow glyph that points right. */
export interface RingArrow {
    fromSeatIndex: number;
    toSeatIndex: number;
    x: number;
    y: number;
    rotation: number;
}

const RADIUS_X = 38;
const RADIUS_Y = 36;
const CENTER = 50;

function point(angleRad: number) {
    return {
        x: CENTER + RADIUS_X * Math.cos(angleRad),
        y: CENTER + RADIUS_Y * Math.sin(angleRad),
    };
}

/** Places seats on an ellipse with the viewer at the bottom. Seat order
 *  follows Draft adjacency: `seatIndex + 1` is the neighbour a round-0 pack
 *  is passed to (`passDirection(0)`), so each step in seat order moves one
 *  slot clockwise on screen (bottom → left → top → right). A viewer-less
 *  event (spectator) anchors seat 0 at the bottom. Pure geometry — the seat
 *  order itself is the server's, never re-derived. */
export function placeSeatsOnRing(
    seatIndexes: readonly number[],
    viewerSeatIndex: number | undefined
): RingSlot[] {
    const sorted = [...seatIndexes].sort((a, b) => a - b);
    const n = sorted.length;
    const anchor =
        viewerSeatIndex !== undefined && sorted.includes(viewerSeatIndex)
            ? sorted.indexOf(viewerSeatIndex)
            : 0;
    return sorted.map((seatIndex, i) => {
        const step = (((i - anchor) % n) + n) % n;
        const angle = Math.PI / 2 + (step * 2 * Math.PI) / n;
        return { seatIndex, ...point(angle) };
    });
}

/** One arrow per adjacent pair, pointing the way the CURRENT round's packs
 *  travel (`passDirection`, the server's own function — ADR 0074). */
export function passArrows(
    slots: readonly RingSlot[],
    round: number
): RingArrow[] {
    const n = slots.length;
    if (n < 2) return [];
    const direction = passDirection(round);
    const bySeat = [...slots].sort((a, b) => a.seatIndex - b.seatIndex);
    return bySeat.map((from, i) => {
        const to = bySeat[(((i + direction) % n) + n) % n];
        return {
            fromSeatIndex: from.seatIndex,
            toSeatIndex: to.seatIndex,
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2,
            rotation:
                (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
        };
    });
}

/** What the ring annotates each seat with, by event phase: queued packs while
 *  drafting, deck colours from Deckbuilding on, the record while Games run,
 *  the winner at the end. */
export interface RingPhaseFacts {
    hint: LimitedEventStatusHint;
    showQueued: boolean;
    showColors: boolean;
    showRecord: boolean;
    winnerSeatIndex: number | null;
}

export function ringPhaseFacts(event: LimitedEventView): RingPhaseFacts {
    const hint = limitedEventStatusHint(event);
    const winner =
        isEventConcluded(event.status) && event.standings.length > 0
            ? event.standings[0].seatIndex
            : null;
    return {
        hint,
        showQueued: hint === "drafting",
        showColors:
            hint === "deckbuilding" ||
            hint === "ready to play" ||
            hint === "playing" ||
            hint === "finished",
        showRecord: hint === "playing" || hint === "finished",
        winnerSeatIndex: winner,
    };
}

/** "2-1" (or "2-1-1" with draws) from the derived standings; `null` for a seat
 *  with no decided match yet. */
export function seatRecord(
    event: Pick<LimitedEventView, "standings">,
    seatIndex: number
): string | null {
    const row = event.standings.find((r) => r.seatIndex === seatIndex);
    if (!row || row.matchWins + row.matchLosses + row.matchDraws === 0) {
        return null;
    }
    return row.matchDraws > 0
        ? `${row.matchWins}-${row.matchLosses}-${row.matchDraws}`
        : `${row.matchWins}-${row.matchLosses}`;
}

/** The compact tile's one-line summary: "6 seats · 2 humans · 3 bots · 1 open". */
export function tableSummaryLine(
    seats: readonly Pick<
        LimitedEventView["seats"][number],
        "isBot" | "userId"
    >[]
): string {
    const bots = seats.filter((s) => s.isBot).length;
    const humans = seats.filter(
        (s) => !s.isBot && s.userId !== undefined
    ).length;
    const open = seats.length - bots - humans;
    const parts = [`${seats.length} seats`];
    if (humans > 0)
        parts.push(`${humans} ${humans === 1 ? "human" : "humans"}`);
    if (bots > 0) parts.push(`${bots} ${bots === 1 ? "bot" : "bots"}`);
    if (open > 0) parts.push(`${open} open`);
    return parts.join(" · ");
}
