// Leaving a game for its lobby (issue #10229): clear the stored session, then
// navigate IN-APP. Never a full-page `window.location` load — that asked the
// browser to unload the page, so any in-flight request (the game-end Verdict
// judge keeps one for minutes) could surface a browser-delegated "Leave site?"
// dialog, and it threw away the loaded bundle for nothing. Leaving never waits
// for the judge or the review: their work is dropped with the board.

import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { PublicMatch } from "@convex/matches";
import { clearSession } from "~/lib/session";
import { lobbyRouteForMatch } from "~/lib/matchNavigation";

export function useLeaveToLobby(): (match: PublicMatch | null) => void {
    const navigate = useNavigate();
    return useCallback(
        (match: PublicMatch | null) => {
            // Clear the session so the lobby is reachable (PRD #387 user
            // story 32) and the game route does not reopen this game.
            clearSession();
            const route = lobbyRouteForMatch(match);
            if (route.to === "/") void navigate({ to: "/", replace: true });
            else void navigate({ ...route, replace: true });
        },
        [navigate]
    );
}
