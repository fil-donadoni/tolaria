// Verdict Proposal capture for a vs-Bot game (issue #3984, GLOSSARY.md
// § Verdict Proposal): record the HUMAN seat's decisions during play, judge a
// sample of them once the game is over.
//
// DURING PLAY nothing is asked of the Brain. Each window the engine says the
// human owes (the tick's `owedPlayerIds`, ADR 0047) and that is a fresh
// decision (`isHumanDecisionStart`, the Bot's own gate) is captured as the
// seat's OWN projection plus its OWN decklist; every mutation the seat then
// submits is recorded against it through a read-only tap on the Convex client.
//
// AT GAME END the game-end module is loaded (a lazy chunk — the identification
// and the sample never weigh on the board's bundle) and the Brain is consulted
// once per sampled decision at a fixed budget and seed. The list lands in
// `verdict-proposal-store.ts` for the panel (issue #3986); nothing is written
// anywhere else, and a game swap drops it unanswered.

import { useEffect } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useResilientQuery } from "./useResilientQuery";
import { tapClientMutations } from "~/lib/ai/mutation-tap";
import {
    capturingGame,
    clearHumanCapture,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
} from "~/lib/ai/human-decision-capture";
import { observeHumanWindow } from "~/lib/ai/human-decision-start";
import {
    clearVerdictProposals,
    setVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { VERDICT_PROPOSAL_CONFIG } from "~/lib/ai/verdict-proposal-config";
import { consultBrain } from "~/lib/ai/brain-client";

export function useVerdictProposalCapture(
    gameId: Id<"games">,
    botId: string | null,
    humanId: string | null
): void {
    const convex = useConvex();
    const active = !!botId && !!humanId && humanId !== botId;

    // The same tick the driver gates on — Convex shares one subscription.
    const tick = useResilientQuery(
        api.gameReads.getGameTick,
        active ? { gameId } : "skip"
    ).data;
    const humanOwes = !!(
        active &&
        tick &&
        !tick.gameOver &&
        tick.owedPlayerIds?.includes(humanId!)
    );
    // The human's own projection — the board holds the same subscription.
    const humanState = useResilientQuery(
        api.game.getPublicState,
        humanOwes ? { gameId, playerId: humanId! } : "skip"
    ).data;
    const humanDeck = useResilientQuery(
        api.gameReads.getSeatDeck,
        active ? { gameId, playerId: humanId! } : "skip"
    ).data;
    const gameOver = !!tick?.gameOver;

    useEffect(() => {
        if (!active) return;
        startHumanCapture(gameId, humanId!, {
            limit: VERDICT_PROPOSAL_CONFIG.captureLimit,
            seed: VERDICT_PROPOSAL_CONFIG.seed,
        });
        const untap = tapClientMutations(convex, (call) =>
            recordHumanCall(gameId, call)
        );
        return () => {
            untap();
            clearHumanCapture();
            clearVerdictProposals();
        };
    }, [active, convex, gameId, humanId]);

    useEffect(() => {
        if (!active || !humanState || humanState.gameOver) return;
        observeHumanWindow(
            gameId,
            humanState,
            humanId!,
            humanDeck?.cards.map((c) => c.cardId)
        );
    }, [active, gameId, humanId, humanState, humanDeck]);

    useEffect(() => {
        if (!active || !gameOver) return;
        const decisions = takeHumanDecisions(gameId);
        if (decisions.length === 0) return;
        // No cancel-on-cleanup: under StrictMode the effect re-runs at once
        // and the re-run finds the buffer already taken. A swap is caught at
        // landing instead — a list for a game no longer captured is dropped.
        void import("~/lib/ai/verdict-proposals")
            .then(({ proposeVerdicts }) =>
                proposeVerdicts(
                    decisions,
                    VERDICT_PROPOSAL_CONFIG,
                    (source, budget, seed) =>
                        consultBrain(
                            source.state,
                            source.botId,
                            budget,
                            source.knowledge,
                            undefined,
                            seed
                        ).then((r) => (r.outcome === "move" ? r.move : null))
                )
            )
            .then((list) => {
                if (capturingGame() === gameId) {
                    setVerdictProposals(gameId, list);
                }
            })
            .catch(() => {
                // A failed sample costs only questions; the game is over.
            });
    }, [active, gameId, gameOver]);
}
