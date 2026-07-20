import { useEffect, useMemo, useState } from "react";
import type { Player, StackItem } from "~/types/game";

/** How long a card keeps its just-arrived emphasis after changing zone (ms).
 *  Matches the flight settle time plus a beat of dwell. */
export const ARRIVAL_GLOW_MS = 900;

/** Instance id → zone tag ("hand:p1", "battlefield:p2", "stack", …). Only
 *  zones whose cards are projected with REAL instance ids participate:
 *  hidden zones (opponent hand nulls, sparse library placeholders) are not
 *  flight sources — a card appearing from one is still an "arrival" (glow),
 *  it just has no previous position to fly from. */
type Membership = Map<string, string>;

function collectMembership(players: Player[], stack: StackItem[]): Membership {
    const m: Membership = new Map();
    for (const p of players) {
        for (const c of p.hand) if (c) m.set(c.id, `hand:${p.id}`);
        for (const c of p.battlefield) m.set(c.id, `battlefield:${p.id}`);
        for (const c of p.graveyard) m.set(c.id, `graveyard:${p.id}`);
        for (const c of p.exile) m.set(c.id, `exile:${p.id}`);
    }
    for (const item of stack) m.set(item.id, "stack");
    return m;
}

function sameMembership(a: Membership, b: Membership): boolean {
    if (a.size !== b.size) return false;
    for (const [iid, zone] of a) if (b.get(iid) !== zone) return false;
    return true;
}

/**
 * Zone-change arrival detection for the spatial board's flight animations.
 *
 * The wire is a pure snapshot (one push per committed action, possibly with
 * several simultaneous zone changes) — there is no event feed. So the client
 * diffs consecutive snapshots by stable card instance id: an id whose zone
 * tag changed, or that appeared from a hidden zone, is a "recent arrival"
 * for {@link ARRIVAL_GLOW_MS} and gets (a) the gold arrival emphasis and
 * (b) — on the battlefield — a deferred entry into permanent stacks so its
 * own shared-layout element stays mounted long enough to complete the flight.
 *
 * The first snapshot after mount is the baseline (no arrivals): opening a
 * game mid-match must not light up the whole board.
 */
export function useRecentArrivals(
    players: Player[] | undefined,
    stack: StackItem[] | undefined
): ReadonlySet<string> {
    const [arrivals, setArrivals] = useState<ReadonlySet<string>>(
        () => new Set()
    );
    const [prevMembership, setPrevMembership] = useState<Membership | null>(
        null
    );

    const currMembership = useMemo(
        () => (players ? collectMembership(players, stack ?? []) : null),
        [players, stack]
    );

    // Diff consecutive snapshots via React's documented adjust-state-during-
    // render pattern (the alternative to a setState-in-effect). Compared BY
    // VALUE, not identity: a rebuilt-but-identical membership (fresh array
    // literals upstream) must neither re-fire arrivals nor loop renders.
    if (
        currMembership &&
        (prevMembership === null ||
            !sameMembership(prevMembership, currMembership))
    ) {
        if (prevMembership === null) {
            // Baseline snapshot — no arrivals on first paint.
            setPrevMembership(currMembership);
        } else {
            const moved: string[] = [];
            for (const [iid, zone] of currMembership) {
                const before = prevMembership.get(iid);
                if (before === undefined || before !== zone) moved.push(iid);
            }
            setPrevMembership(currMembership);
            if (moved.length > 0) {
                setArrivals((old) => {
                    const next = new Set(old);
                    for (const id of moved) next.add(id);
                    return next;
                });
            }
        }
    }

    // Expiry: each arrivals-set change schedules its own flush; the cleanup
    // clears the pending timer when a fresher set arrives or on unmount.
    useEffect(() => {
        if (arrivals.size === 0) return;
        const timer = window.setTimeout(
            () => setArrivals(new Set()),
            ARRIVAL_GLOW_MS
        );
        return () => window.clearTimeout(timer);
    }, [arrivals]);

    return arrivals;
}
