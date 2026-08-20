// The global return banner (issue #2582, ADR 0101, PRD #2405 user story 8:
// "a return banner and a nav badge, so that I can always get back to it").
//
// The lobby has offered a resume affordance since #155 (`ActiveGameNotice`),
// but only the lobby: walk into the deck builder or the admin section with a
// game running and every trace of it disappears. This is the shell-level
// strip — one line, one action, present on EVERY route that is not already the
// surface it points at.
//
// Deliberately NOT `ActiveGameNotice`. That component owns the destructive
// half (Leave / Concede Match, a confirmation dialog, per-seat resume for a
// manual table) and belongs where a user goes to deal with the game. Chrome
// offers exactly one verb: go back to it. Abandoning stays on the lobby.
//
// Which is also why the lobby does NOT get this band: a route that already
// offers the same return in full owns it, and the shell stands down rather
// than stacking a weaker second copy (ADR 0069 "one banner"). That is declared
// per route as `ownsReturn` in `SHELL_ROUTE_RULES`, not decided here — this
// component renders whatever `shellShowsReturnBanner` let through.
//
// HEIGHT CONTRACT: `h-9` (`SHELL_RETURN_BANNER_PX`), `shrink-0`, inside the
// shell's TOP band in every mode — so `shellBands` adds it to
// `headerBandHeightPx` and `<main>` shrinks by exactly this much. A banner
// that floated over the content instead would occlude a card row, which is a
// probe failure (`occ`) and the reason it is a band and not an overlay.
import { useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { storeSession } from "~/lib/session";
import { Button } from "~/components/ui/button";
import type { ActiveSession } from "~/hooks/useActiveSession";

export default function AppReturnBanner({
    session,
}: {
    /** The active game / event, already resolved by `AppShell`. */
    session: ActiveSession;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();

    // A game outranks an event: it is the one that can time out on you.
    const game = session.game;
    const event = session.event;

    if (game && user) {
        // Solo / vs-AI seats are `${userId}-p1`; a 2-player seat is the bare
        // id — the same derivation `ActiveGameNotice` makes, and the reason
        // this banner needs the current user at all.
        const seat = game.solo ? `${user._id}-p1` : user._id;
        const resume = () => {
            storeSession(game.gameId, seat);
            void navigate({ to: "/game" });
        };
        return (
            <div
                data-slot="app-return-banner"
                className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-accent/40 bg-accent/15 px-3 text-xs"
            >
                <span className="min-w-0 truncate">
                    {game.status === "playing"
                        ? "A game is in progress."
                        : "A game is waiting for an opponent."}
                </span>
                <Button
                    type="button"
                    variant="primary"
                    size="xs"
                    onClick={resume}
                >
                    Return to game
                </Button>
            </div>
        );
    }

    if (event) {
        return (
            <div
                data-slot="app-return-banner"
                className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-accent/40 bg-accent/15 px-3 text-xs"
            >
                <span className="min-w-0 truncate">
                    {event.type === "draft"
                        ? "A draft is in progress."
                        : "A sealed event is in progress."}
                </span>
                <Button
                    type="button"
                    variant="primary"
                    size="xs"
                    onClick={() =>
                        void navigate({
                            to: "/limited/$eventId",
                            params: { eventId: event.eventId },
                        })
                    }
                >
                    Return to event
                </Button>
            </div>
        );
    }

    return null;
}
