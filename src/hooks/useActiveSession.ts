// The one thing the app shell needs to know about the user's IN-FLIGHT work:
// is there a game to return to, and is there a Limited event to return to
// (issue #2582, PRD #2405 user story 8 — "a return banner and a nav badge, so
// that I can always get back to it").
//
// Both facts already existed, but only on the lobby: `lobby.tsx` queries
// `myActiveGame` for `ActiveGameNotice` and `useMyCurrentLimitedEvents` for
// the Limited box. That means a player who navigates INTO the deck builder or
// the admin section loses every trace of a running game. Lifting the two reads
// into one hook the shell can call is what makes the banner and the nav badge
// global without either component learning Convex.
//
// Reads only — no mutation lives here. Resuming a game is a navigation plus a
// `storeSession` (see `AppReturnBanner`), and abandoning one stays where it
// already is, on the lobby's `ActiveGameNotice`.
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    useMyCurrentLimitedEvents,
    type LimitedEventSummaryView,
} from "~/hooks/useLimitedEvent";

/** Derived from the query, never restated: a hand-written mirror of a Convex
 *  return shape is exactly the drift `useLimitedEvent.ts` avoids the same way. */
type MyActiveGame = NonNullable<
    FunctionReturnType<typeof api.game.myActiveGame>
>;

/** The game the viewer can return to, reduced to what chrome needs. */
export interface ActiveSessionGame {
    gameId: MyActiveGame["gameId"];
    name: string;
    status: MyActiveGame["status"];
    /** Solo/vs-AI seats are `${userId}-p1`; a 2-player seat is the bare id. */
    solo: boolean;
}

/** The Limited event the viewer can return to. */
export interface ActiveSessionEvent {
    eventId: LimitedEventSummaryView["_id"];
    type: LimitedEventSummaryView["type"];
}

export interface ActiveSession {
    game: ActiveSessionGame | null;
    event: ActiveSessionEvent | null;
    /** `true` while either read is still in flight — the chrome renders
     *  nothing rather than flashing a banner it may immediately retract. */
    loading: boolean;
}

const NOTHING: ActiveSession = { game: null, event: null, loading: true };

/**
 * The viewer's active game + Limited event.
 *
 * Both underlying queries are identity-derived server-side and take no args,
 * and both are skipped while the tab is hidden (`usePageVisible`) exactly as
 * the lobby already skips them — the shell is mounted on every route, so a
 * background tab would otherwise hold two live subscriptions forever.
 */
export function useActiveSession(): ActiveSession {
    const pageVisible = usePageVisible();
    const activeGame = useQuery(
        api.game.myActiveGame,
        pageVisible ? {} : "skip"
    );
    const events = useMyCurrentLimitedEvents();

    if (activeGame === undefined || events === undefined) return NOTHING;

    // A finished game is history, not something to return to: `myActiveGame`
    // reports the seat's last match, and the lobby's own notice is where a
    // finished one is dealt with.
    const game =
        activeGame && activeGame.status !== "finished"
            ? {
                  gameId: activeGame.gameId,
                  name: activeGame.name,
                  status: activeGame.status,
                  solo: activeGame.solo,
              }
            : null;

    // `myCurrentLimitedEvents` already excludes concluded events, so the first
    // one is the one to offer. A user is in at most a handful, and the ordering
    // is the query's — the shell does not re-rank it.
    const first = events[0];
    const event = first ? { eventId: first._id, type: first.type } : null;

    return { game, event, loading: false };
}
