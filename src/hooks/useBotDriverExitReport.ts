// The vs-AI driver telling the server the player is no longer at the board
// while the Bot is owed (`botLiveness.reportDriverExit`,
// `convex/botDriverExitStore.ts`). The server deadline advances that window
// either way; told the player was gone at that exact state version, it files
// no Bot fault — a page nobody is looking at is not a driver that died on a
// live board.
//
// Three ways the player goes, one report each, at most once per version:
//
// - the hook's cleanup — navigation away, or a swap to another game on the
//   same driver instance;
// - `pagehide` — the tab closed (no React cleanup runs then);
// - `visibilitychange` → `hidden` — the tab switched away or the window
//   minimised. A hidden page is throttled or frozen by the browser and
//   suspended by a phone OS (an iOS app switch fires `visibilitychange`,
//   never `pagehide`), so its driver may miss the deadline without any fault.
//   While the page STAYS hidden, every new owed version is reported too.
//
// A hidden driver that still acts moves the game past the reported version,
// and an exit at an older version says nothing to the deadline. Known limit:
// a player who comes back to the SAME version and finds the driver dead gets
// the advance unreported.

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type ReportExit = (args: {
    gameId: Id<"games">;
    seq: number;
}) => Promise<unknown>;

type Reported = { gameId: string; seq: number } | null;

function pageHidden(): boolean {
    return (
        typeof document !== "undefined" && document.visibilityState === "hidden"
    );
}

/** Send one exit report unless this game's version was already reported.
 *  Fire-and-forget: a rejection or a throw is swallowed. */
function sendExit(
    report: ReportExit,
    reported: { current: Reported },
    gameId: Id<"games">,
    seq: number | null
): void {
    if (seq === null) return;
    const last = reported.current;
    if (last && last.gameId === gameId && last.seq === seq) return;
    reported.current = { gameId, seq };
    try {
        void report({ gameId, seq }).catch(() => {});
    } catch {
        // A lost exit costs one noisy report, never a move.
    }
}

/** Report, at most once per state version, that the player left the board
 *  while the Bot was owed `botOwedSeq` (`null` when the Bot is not owed). */
export function useBotDriverExitReport(
    gameId: Id<"games">,
    botId: string | null,
    botOwedSeq: number | null
): void {
    const reportDriverExit = useMutation(api.botLiveness.reportDriverExit);
    const reportRef = useRef<ReportExit>(reportDriverExit);
    const owedSeqRef = useRef<number | null>(null);
    // The version last reported, per game: the dedupe for every path.
    const reportedRef = useRef<Reported>(null);

    useEffect(() => {
        reportRef.current = reportDriverExit;
        owedSeqRef.current = botId ? botOwedSeq : null;
        // Still hidden, and the Bot owes a NEW version: the player is still
        // away from it.
        if (pageHidden()) {
            sendExit(
                reportRef.current,
                reportedRef,
                gameId,
                owedSeqRef.current
            );
        }
    });

    useEffect(() => {
        if (!botId) return;
        const send = () =>
            sendExit(
                reportRef.current,
                reportedRef,
                gameId,
                owedSeqRef.current
            );
        const onVisibility = () => {
            if (pageHidden()) send();
        };
        window.addEventListener("pagehide", send);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("pagehide", send);
            document.removeEventListener("visibilitychange", onVisibility);
            send();
            owedSeqRef.current = null;
        };
    }, [gameId, botId]);
}
