// Drop (GLOSSARY.md): a Seat leaving a STARTED Limited Event. The Seat keeps
// its User and nickname — standings still list it — but nobody drives it any
// more, so the engine treats it like a Bot Drafter seat wherever a decision
// would otherwise wait on its occupant (draft picks, deckbuilding) and
// concedes its pairings (`rounds.ts`).

/** The structural slice of a Seat the Drop questions read. */
export interface DroppableSeat {
    isBot?: boolean;
    droppedAt?: number;
}

/** Has this Seat's occupant dropped from the started event? */
export function isDroppedSeat(seat: DroppableSeat): boolean {
    return seat.droppedAt !== undefined;
}

/** Is this Seat driven by the server rather than a person — a Bot Drafter, or
 *  a dropped Seat. The draft makes its picks at once and the event never
 *  waits on its deck. */
export function isAutoDrivenSeat(seat: DroppableSeat): boolean {
    return seat.isBot === true || isDroppedSeat(seat);
}
