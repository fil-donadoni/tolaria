// Pairing ↔ Match linkage (PRD #1628 stories 8-15, ADR 0076, issue #1645) —
// the pure half of "play your round pairing, and have it count".
//
// Same discipline as its neighbours (`rounds.ts`, `standings.ts`, `swiss.ts`):
// every decision is a plain function of plain data, so the Convex mutation is a
// thin shell that reads the rows, calls this, and writes the result back.
// Nothing here touches `ctx`, the DB, `Math.random` or the clock.
//
// Two directions, one linkage:
//
//  - **Start** — `resolveStartablePairing` answers "may this seat sit down and
//    play right now, and against whom", and `bindPairingMatch` stamps the
//    created Match onto the pairing so a finished Match finds its pairing
//    without scanning (ADR 0076 decision 2).
//  - **Record** — `recordPlayedPairing` folds a FINISHED Match's game score
//    back into that pairing as a `source: "played"` result.
//
// What this module deliberately does NOT do is decide what a result MEANS.
// `classifyPairingResult` (`standings.ts`) is the single authority on win /
// draw / double loss, and it stays that way: recording only ever writes the
// primitive the standings derive from — the games each side won.

import type { LimitedPairing, LimitedRound } from "./eventTypes";

/** The pairing a Match is bound to, in the MATCH's own seat order: `seatA` is
 *  the seat of `matches.players[0]` (the seat that STARTED the Match) and
 *  `seatB` that of `players[1]`. Deliberately NOT the event pairing's own A/B
 *  order — the starter may be either side of it — which is why
 *  `recordPlayedPairing` re-orients the score rather than copying it across.
 *  Stored on `matches.limitedPairing` / `games.limitedPairing`. */
export interface PairingMatchLink {
    round: number;
    seatA: number;
    seatB: number;
}

/** A finished Match's game score, in the SAME seat order as its
 *  {@link PairingMatchLink} — i.e. `matches.players[i].score`. */
export interface PlayedPairingScore {
    winsA: number;
    winsB: number;
}

/** What `resolveStartablePairing` found: the round the pairing belongs to, the
 *  pairing itself, and the seat the caller faces. */
export interface StartablePairing {
    round: LimitedRound;
    pairing: LimitedPairing;
    opponentSeatIndex: number;
}

/** The pairing `seatIndex` may start a Match for in `currentRound`, or a throw
 *  whose message is safe to surface to the client.
 *
 *  Every rejection here is a real state a client can reach by clicking a stale
 *  button, so each gets its own message rather than one generic refusal:
 *  the round moved on, the seat isn't paired, the seat holds the bye (nothing
 *  to play — `openRound` already recorded it as a win), or the pairing is
 *  already decided (played, timed out, or otherwise closed).
 *
 *  Does NOT decide whether a Match already EXISTS for the pairing — that needs
 *  the `matches` row (a Match abandoned before it started leaves a dangling
 *  `matchId`), so it stays in the mutation shell. */
export function resolveStartablePairing(
    rounds: readonly LimitedRound[],
    currentRound: number | undefined,
    seatIndex: number
): StartablePairing {
    if (currentRound === undefined) {
        throw new Error("This event has no round in progress.");
    }
    const round = rounds.find((r) => r.roundNumber === currentRound);
    if (!round) {
        throw new Error("This event has no round in progress.");
    }
    const pairing = round.pairings.find(
        (p) => p.seatA === seatIndex || p.seatB === seatIndex
    );
    if (!pairing) {
        throw new Error("You are not paired in this round.");
    }
    if (pairing.seatB === undefined) {
        throw new Error(
            "You have a bye this round — there is no Match to play."
        );
    }
    if (pairing.result) {
        throw new Error("Your pairing for this round is already decided.");
    }
    return {
        round,
        pairing,
        opponentSeatIndex:
            pairing.seatA === seatIndex ? pairing.seatB : pairing.seatA,
    };
}

/** Does `pairing` cover exactly the two seats of `link` (in either order)? */
function pairingCoversLink(
    pairing: LimitedPairing,
    link: PairingMatchLink
): boolean {
    if (pairing.seatB === undefined) return false;
    return (
        (pairing.seatA === link.seatA && pairing.seatB === link.seatB) ||
        (pairing.seatA === link.seatB && pairing.seatB === link.seatA)
    );
}

/** Rewrites exactly one pairing inside `rounds`, leaving every other round and
 *  pairing byte-identical. Returns `null` when `update` declines. */
function mapPairing(
    rounds: readonly LimitedRound[],
    roundNumber: number,
    match: (pairing: LimitedPairing) => boolean,
    update: (pairing: LimitedPairing) => LimitedPairing | null
): LimitedRound[] | null {
    const roundIdx = rounds.findIndex((r) => r.roundNumber === roundNumber);
    if (roundIdx === -1) return null;
    const round = rounds[roundIdx];
    const pairingIdx = round.pairings.findIndex(match);
    if (pairingIdx === -1) return null;
    const next = update(round.pairings[pairingIdx]);
    if (next === null) return null;
    const pairings = round.pairings.map((p, i) =>
        i === pairingIdx ? next : p
    );
    return rounds.map((r, i) => (i === roundIdx ? { ...round, pairings } : r));
}

/** Stamps `matchId` onto `seatIndex`'s pairing in round `roundNumber` — the
 *  half of the linkage that lets a finished Match find its pairing without
 *  scanning the event's rounds (ADR 0076 decision 2).
 *
 *  Returns `null` (write nothing) when the round or pairing is gone, when the
 *  pairing is a bye, when it is already decided, or when it ALREADY carries a
 *  Match — a pairing is started once, and silently repointing it at a second
 *  Match is exactly how two Matches would both claim the same result. */
export function bindPairingMatch(
    rounds: readonly LimitedRound[],
    roundNumber: number,
    seatIndex: number,
    matchId: string
): LimitedRound[] | null {
    return mapPairing(
        rounds,
        roundNumber,
        (p) => p.seatA === seatIndex || p.seatB === seatIndex,
        (pairing) => {
            if (pairing.seatB === undefined) return null;
            if (pairing.result) return null;
            if (pairing.matchId) return null;
            return { ...pairing, matchId };
        }
    );
}

/** Clears a dangling `matchId` from `seatIndex`'s pairing — the recovery path
 *  for a pairing Match that was abandoned before it ever started (the waiting
 *  room's `leaveGame` deletes the Match row, leaving the pairing pointing at
 *  nothing). Returns `null` when there is nothing to clear. */
export function unbindPairingMatch(
    rounds: readonly LimitedRound[],
    roundNumber: number,
    seatIndex: number
): LimitedRound[] | null {
    return mapPairing(
        rounds,
        roundNumber,
        (p) => p.seatA === seatIndex || p.seatB === seatIndex,
        (pairing) =>
            pairing.matchId === undefined || pairing.result
                ? null
                : { ...pairing, matchId: undefined }
    );
}

/** Folds a FINISHED pairing Match's game score into its pairing as a
 *  `source: "played"` result (PRD #1628 story 14/15).
 *
 *  Every guard is a real state, and each one returns `null` (write nothing)
 *  rather than throwing — this runs inside the game-over/forfeit path, where a
 *  throw would roll back the Match's own completion:
 *
 *  - the round or pairing named by `link` is gone (an event edited underneath);
 *  - the pairing is not the one the Match was bound to (`matchId` mismatch) —
 *    the strongest form of "a player cannot record a result for a pairing that
 *    isn't theirs", since `matchId` was written server-side at start;
 *  - the pairing is ALREADY decided — recording is idempotent, so the
 *    SBA/concede path and the forfeit path can both fire for the same Match
 *    (a forfeit right after the deciding game) without double-counting.
 *
 *  The score is re-oriented into the EVENT pairing's own seat order: `link`
 *  carries the Match's order, which is only the pairing's order when the seat
 *  that started the Match happens to be its `seatA`. */
export function recordPlayedPairing(
    rounds: readonly LimitedRound[],
    link: PairingMatchLink,
    matchId: string,
    score: PlayedPairingScore
): LimitedRound[] | null {
    return mapPairing(
        rounds,
        link.round,
        (p) => pairingCoversLink(p, link),
        (pairing) => {
            if (pairing.matchId !== matchId) return null;
            if (pairing.result) return null;
            const viewerIsSeatA = pairing.seatA === link.seatA;
            return {
                ...pairing,
                result: {
                    winsA: viewerIsSeatA ? score.winsA : score.winsB,
                    winsB: viewerIsSeatA ? score.winsB : score.winsA,
                    source: "played" as const,
                },
            };
        }
    );
}
