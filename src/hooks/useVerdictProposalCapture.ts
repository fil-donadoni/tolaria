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
// `verdict-proposal-store.ts` for the panel (issue #3986); nothing reaches the
// server.
//
// A RELOAD costs nothing: the capture and the list are kept in
// client storage, so a remount of the same game resumes the capture, and a
// mount with the game already over offers the stored list — or builds it from
// the stored decisions — without depending on the tab never reloading.

import { useEffect, useMemo } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useResilientQuery } from "./useResilientQuery";
import { tapClientMutations } from "~/lib/ai/mutation-tap";
import {
    capturingGame,
    clearHumanCapture,
    humanCaptureReady,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
} from "~/lib/ai/human-decision-capture";
import { observeHumanWindow } from "~/lib/ai/human-decision-start";
import {
    clearVerdictProposals,
    loadVerdictProposals,
    setVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { VERDICT_PROPOSAL_CONFIG } from "~/lib/ai/verdict-proposal-config";
import {
    proposalCountsReport,
    reportNoDecisionCaptured,
    reportProposalCounts,
    reportSampleFailed,
    type JudgeOutcomeTally,
} from "~/lib/ai/verdict-proposal-telemetry";
import { consultBrain } from "~/lib/ai/brain-client";
import { seatKnowledge } from "~/lib/ai/seat-knowledge";

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
    // The seat's decklist as definition ids (issue #5617) — the driver's
    // read. The Brain worker judging it was primed by the driver with the
    // game's Manifest, which holds this deck.
    const humanKnowledge = useResilientQuery(
        api.gameReads.getSeatDeckKnowledge,
        active ? { gameId, playerId: humanId! } : "skip"
    ).data;
    const legacyDeck = useResilientQuery(
        api.gameReads.getSeatDeck,
        active && humanKnowledge === null
            ? { gameId, playerId: humanId! }
            : "skip"
    ).data;
    const humanDeck = useMemo(
        () => seatKnowledge(humanKnowledge, legacyDeck),
        [humanKnowledge, legacyDeck]
    );
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
        observeHumanWindow(gameId, humanState, humanId!, humanDeck?.cardIds);
    }, [active, gameId, humanId, humanState, humanDeck]);

    useEffect(() => {
        if (!active || !gameOver) return;
        // No cancel-on-cleanup: under StrictMode the effect re-runs at once
        // and the re-run finds the buffer already taken. A swap is caught at
        // landing instead — a list for a game no longer captured is dropped.
        void buildProposalsAtGameEnd(gameId);
    }, [active, gameId, gameOver]);
}

/** The game is over: offer the stored list if this game already has one (a
 *  reload after it was built — the Brain is not consulted again), else build
 *  it from the captured decisions, rehydrated first (issue #8889). */
async function buildProposalsAtGameEnd(gameId: string): Promise<void> {
    if (await loadVerdictProposals(gameId)) return;
    await humanCaptureReady(gameId);
    const decisions = takeHumanDecisions(gameId);
    if (decisions.length === 0) {
        reportNoDecisionCaptured(gameId);
        return;
    }
    const judged: JudgeOutcomeTally = {};
    try {
        const { proposeVerdicts } = await import("~/lib/ai/verdict-proposals");
        const list = await proposeVerdicts(
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
                ).then((r) => {
                    judged[r.outcome] = (judged[r.outcome] ?? 0) + 1;
                    return r.outcome === "move" ? r.move : null;
                })
        );
        // Why a game offers no review, or a shorter one than expected — to
        // Sentry as well as the console (issue #8732).
        reportProposalCounts(proposalCountsReport(gameId, list, judged));
        if (capturingGame() === gameId) {
            setVerdictProposals(gameId, list);
        }
    } catch (cause: unknown) {
        // A failed sample costs only questions, but it takes the post-game
        // review with it: loud, or nobody can tell why.
        reportSampleFailed(gameId, cause);
    }
}
