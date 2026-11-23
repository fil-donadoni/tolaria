// Pondering, the page's half (issue #10472, ADR 0185 Amendment I): while the
// human decides, the Brain Worker grows the tree its last consult kept.
//
// Each human window the consult path opens (`onHumanWindow`) asks once for
// the BOT's projection of the same position — a one-shot read, never a
// second standing subscription (the driver's tick gate, PRD #1776 T3) — and,
// when it is still that position, posts it to the Worker with the path from
// the last consult to it (`peekConsultPath`). The Bot's projection, never the
// human's: the tree must grow from what the Bot may know.
//
// A hidden page stops pondering (`visibilitychange` → `hidden`), and nothing
// resumes it until the next window opens. On a phone too — the owner's ruling
// of 2026-11-22 — with the lower node cap the Worker applies there.
//
// Nothing here blocks a click or reaches the server beyond that one read; a
// failure of any kind is a lost ponder, never a lost move.

import { useEffect } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { onHumanWindow, peekConsultPath } from "~/lib/ai/consult-path";
import { ponderBrain, stopPonderingBrain } from "~/lib/ai/brain-client";
import { deviceClass } from "~/lib/ai/bot-search-telemetry";

function pageHidden(): boolean {
    return (
        typeof document !== "undefined" && document.visibilityState === "hidden"
    );
}

export function useBrainPonder(
    gameId: Id<"games">,
    botId: string | null
): void {
    const convex = useConvex();

    useEffect(() => {
        if (!botId) return;
        let mobile = false;
        try {
            mobile = deviceClass().mobile;
        } catch {
            // Unknown device: the desktop cap.
        }
        const unsubscribe = onHumanWindow((game, seq) => {
            if (game !== gameId || pageHidden()) return;
            void (async () => {
                try {
                    const state = await convex.query(api.game.getPublicState, {
                        gameId,
                        playerId: botId,
                    });
                    if (!state || state.seq !== seq || state.gameOver) return;
                    const steps = await peekConsultPath(gameId, seq);
                    if (!steps || pageHidden()) return;
                    ponderBrain(state, gameId, steps, mobile);
                } catch {
                    // A lost ponder, never a lost move.
                }
            })();
        });
        const onVisibility = () => {
            if (pageHidden()) stopPonderingBrain();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            unsubscribe();
            document.removeEventListener("visibilitychange", onVisibility);
            stopPonderingBrain();
        };
    }, [convex, gameId, botId]);
}
