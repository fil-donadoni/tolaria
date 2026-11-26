// The human half of the Bot's consult path (issue #10470, ADR 0185): what the
// human seat decided between two of the Bot's consults, for the Brain Worker
// to walk its kept tree along (`consult-path.ts`).
//
// Each window the engine says the human owes (the tick's `owedPlayerIds`) is
// noted on the human's OWN projection — the view their decision was made on,
// which the search's keying reads their hand card from — and every mutation
// this client submits for the human is tapped into the open window. The Bot
// half is the driver's: it names every move it submits.
//
// Nothing here consults the Brain or blocks a click: one subscription the
// board already holds (Convex shares it) and one array push per call.

import { useEffect } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useResilientQuery } from "./useResilientQuery";
import { publicStateArgs } from "~/lib/public-state-args";
import { tapClientMutations } from "~/lib/ai/mutation-tap";
import { isSeatOwnView } from "~/lib/ai/human-decision-capture";
import {
    noteHumanCall,
    noteHumanView,
    startConsultPath,
    stopConsultPath,
} from "~/lib/ai/consult-path";

export function useConsultPathCapture(
    gameId: Id<"games">,
    botId: string | null,
    humanId: string | null
): void {
    const convex = useConvex();
    // The tick the driver gates on — Convex shares one subscription.
    const tick = useResilientQuery(
        api.gameReads.getGameTick,
        botId ? { gameId } : "skip"
    ).data;
    const owedPlayerIds = tick?.owedPlayerIds;

    useEffect(() => {
        if (!botId) return;
        startConsultPath(gameId, botId);
        const untap = tapClientMutations(convex, (call) =>
            noteHumanCall(gameId, call)
        );
        return () => {
            untap();
            stopConsultPath(gameId);
        };
    }, [convex, gameId, botId]);

    const humanOwes =
        !!humanId && !!owedPlayerIds && owedPlayerIds.includes(humanId);
    const humanView = useResilientQuery(
        api.game.getPublicState,
        humanOwes && humanId ? publicStateArgs(gameId, humanId) : "skip"
    ).data;

    useEffect(() => {
        if (!humanOwes || !humanId || !humanView || humanView.gameOver) return;
        // Right after the owed seat changes, the query may still hold another
        // view for a render — never note a decision on it.
        if (!isSeatOwnView(humanView, humanId)) return;
        noteHumanView(gameId, humanView, humanId);
    }, [gameId, humanId, humanOwes, humanView]);
}
