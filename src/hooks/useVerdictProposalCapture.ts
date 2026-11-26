// Verdict Proposal capture for a vs-Bot or a solo game (issue #3984, issue
// #10088, GLOSSARY.md § Verdict Proposal): record the HUMAN seat's decisions
// during play — both seats in solo, where one person plays both — judge a
// sample of them once the game is over. The player's Plan statements and
// comments ride with the capture (`human-decision-capture.ts`).
//
// DURING PLAY nothing is asked of the Brain. Each window the engine says the
// human owes (the tick's `owedPlayerIds`, ADR 0047) and that is a fresh
// decision (`isHumanDecisionStart`, the Bot's own gate) is captured as the
// seat's OWN projection plus its OWN decklist; every mutation the seat then
// submits is recorded against it through a read-only tap on the Convex client.
//
// AT GAME END the game-end module is loaded (a lazy chunk — the identification
// and the sample never weigh on the board's bundle) and the judge
// (`verdict-judge.ts`), on Workers of its own primed with the game's Manifest,
// is asked about every sampled decision at once, at a fixed budget and seed.
// The list lands in `verdict-proposal-store.ts` for the panel (issue #3986);
// the server keeps no proposal. Leaving the game stops the judge.
//
// A RELOAD costs nothing: the capture and the list are kept in
// client storage, so a remount of the same game resumes the capture, and a
// mount with the game already over offers the stored list — or builds it from
// the stored decisions — without depending on the tab never reloading.

import { useEffect, useMemo, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import { publicStateArgs } from "~/lib/public-state-args";
import type { Id } from "@convex/_generated/dataModel";
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import { useResilientQuery } from "./useResilientQuery";
import { tapClientMutations } from "~/lib/ai/mutation-tap";
import {
    capturingGame,
    clearHumanCapture,
    humanCaptureReady,
    humanPlans,
    isSeatOwnView,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
} from "~/lib/ai/human-decision-capture";
import { observeHumanWindow } from "~/lib/ai/human-decision-start";
import {
    clearVerdictJudging,
    clearVerdictProposals,
    loadVerdictProposals,
    setVerdictJudging,
    setVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { VERDICT_PROPOSAL_CONFIG } from "~/lib/ai/verdict-proposal-config";
import {
    proposalCountsReport,
    reportNoDecisionCaptured,
    reportProposalCounts,
    reportSampleFailed,
} from "~/lib/ai/verdict-proposal-telemetry";
import { openVerdictJudge, type VerdictJudge } from "~/lib/ai/verdict-judge";
import { seatKnowledge } from "~/lib/ai/seat-knowledge";

/** The seat's decklist as definition ids (issue #5617) — the driver's read.
 *  The judge searches it as the seat's own deck knowledge. */
function useSeatDeckIds(
    gameId: Id<"games">,
    seatId: string | null
): readonly string[] | undefined {
    const knowledge = useResilientQuery(
        api.gameReads.getSeatDeckKnowledge,
        seatId ? { gameId, playerId: seatId } : "skip"
    ).data;
    const legacyDeck = useResilientQuery(
        api.gameReads.getSeatDeck,
        seatId && knowledge === null ? { gameId, playerId: seatId } : "skip"
    ).data;
    return useMemo(
        () => seatKnowledge(knowledge, legacyDeck),
        [knowledge, legacyDeck]
    )?.cardIds;
}

/** The seat's Definition Manifest, as `useVsAiDriver` reads the Bot's: both
 *  maindecks, both companions, the seat's sideboard. The same subscription
 *  the board's gate holds (`definition-manifest-gate.tsx`). */
function useSeatManifest(
    gameId: Id<"games">,
    seatId: string | null
): readonly DefinitionManifestEntry[] | undefined {
    return useResilientQuery(
        api.gameReads.getDefinitionManifest,
        seatId ? { gameId, playerId: seatId } : "skip"
    ).data?.entries;
}

/** The judge of one game, and the Manifests it is primed with — held across
 *  renders by the hook, used by the game-end path. */
type JudgeHost = {
    manifests: readonly (readonly DefinitionManifestEntry[])[];
    judge: { gameId: string; open: VerdictJudge } | null;
};

/** Stop the judge `host` holds for `gameId`, once the game is really left: an
 *  effect that only re-runs resumes the same capture within the task. */
function closeJudgeIfLeft(host: JudgeHost, gameId: string): void {
    queueMicrotask(() => {
        if (capturingGame() !== gameId && host.judge?.gameId === gameId) {
            host.judge.open.close();
            host.judge = null;
        }
    });
}

export function useVerdictProposalCapture(
    gameId: Id<"games">,
    /** The seats whose decisions are captured: a vs-Bot game's human seat,
     *  or a solo game's two seats (at most two). Empty = no capture. */
    seatIds: readonly string[],
    /** Whether the viewer may give a Verdict (issue #10229): the capture and
     *  the game-end judge run for testers and admins only — the review they
     *  feed is offered to no one else, and the server refuses anyone else. */
    mayJudge: boolean
): void {
    const convex = useConvex();
    const [firstSeat = null, secondSeat = null] = seatIds;
    const active = mayJudge && firstSeat !== null;
    // A stable identity for the effect below: the seats, not the array.
    const seatsKey = seatIds.join("|");

    // The same tick the driver gates on — Convex shares one subscription.
    const tick = useResilientQuery(
        api.gameReads.getGameTick,
        active ? { gameId } : "skip"
    ).data;
    // The captured seat the engine waits on now — solo: whichever of the two.
    const owing =
        active && tick && !tick.gameOver
            ? ([firstSeat, secondSeat].find(
                  (seat) => seat !== null && tick.owedPlayerIds?.includes(seat)
              ) ?? null)
            : null;
    // That seat's own projection — the board holds the same subscription.
    const owingState = useResilientQuery(
        api.game.getPublicState,
        owing ? publicStateArgs(gameId, owing) : "skip"
    ).data;
    const firstDeck = useSeatDeckIds(gameId, active ? firstSeat : null);
    const secondDeck = useSeatDeckIds(gameId, active ? secondSeat : null);
    const firstManifest = useSeatManifest(gameId, active ? firstSeat : null);
    const secondManifest = useSeatManifest(gameId, active ? secondSeat : null);
    const gameOver = !!tick?.gameOver;
    const judgeHost = useRef<JudgeHost>({ manifests: [], judge: null });

    // Above the game-end effect: a judge opened there finds them.
    useEffect(() => {
        const manifests = [firstManifest, secondManifest].filter(
            (m) => m !== undefined
        );
        const host = judgeHost.current;
        host.manifests = manifests;
        for (const entries of manifests) host.judge?.open.prime(entries);
    }, [firstManifest, secondManifest]);

    useEffect(() => {
        if (!active) return;
        startHumanCapture(gameId, seatsKey.split("|"), {
            limit: VERDICT_PROPOSAL_CONFIG.captureLimit,
            seed: VERDICT_PROPOSAL_CONFIG.seed,
        });
        const untap = tapClientMutations(convex, (call) =>
            recordHumanCall(gameId, call)
        );
        const host = judgeHost.current;
        return () => {
            untap();
            clearHumanCapture();
            clearVerdictProposals();
            closeJudgeIfLeft(host, gameId);
        };
    }, [active, convex, gameId, seatsKey]);

    useEffect(() => {
        if (!active || !owing || !owingState || owingState.gameOver) return;
        // Solo: right after the owed seat changes, the query may still hold
        // the other seat's view for a render — never classify on it.
        if (!isSeatOwnView(owingState, owing)) return;
        observeHumanWindow(
            gameId,
            owingState,
            owing,
            owing === firstSeat ? firstDeck : secondDeck
        );
    }, [active, gameId, owing, owingState, firstSeat, firstDeck, secondDeck]);

    useEffect(() => {
        if (!active || !gameOver) return;
        // No cancel-on-cleanup: under StrictMode the effect re-runs at once
        // and the re-run finds the buffer already taken. A swap is caught at
        // landing instead — a list for a game no longer captured is dropped.
        void buildProposalsAtGameEnd(judgeHost.current, gameId);
    }, [active, gameId, gameOver]);
}

/** The game is over: offer the stored list if this game already has one (a
 *  reload after it was built — the Brain is not consulted again), else build
 *  it from the captured decisions, rehydrated first (issue #8889). */
async function buildProposalsAtGameEnd(
    host: JudgeHost,
    gameId: Id<"games">
): Promise<void> {
    if (await loadVerdictProposals(gameId)) return;
    await humanCaptureReady(gameId);
    const decisions = takeHumanDecisions(gameId);
    if (decisions.length === 0) {
        reportNoDecisionCaptured(gameId);
        return;
    }
    // The judge has Workers of its own, so nothing it does can stand between
    // the next game's Bot and its decisions. A failed consult costs that
    // decision.
    const open = openVerdictJudge();
    const { judge, tally, timings, close } = open;
    host.judge = { gameId, open };
    // Once the game was left — even if it was re-opened since, which builds its
    // own list — this one shows nothing and lands nowhere.
    const current = () =>
        host.judge?.open === open && capturingGame() === gameId;
    for (const entries of host.manifests) open.prime(entries);
    // Shown in the game-over dialog until the list lands (issue #10229): on a
    // slow device a silent judge reads as "no review".
    setVerdictJudging(gameId, 0, null);
    try {
        const { proposeVerdicts } = await import("~/lib/ai/verdict-proposals");
        const list = await proposeVerdicts(
            decisions,
            VERDICT_PROPOSAL_CONFIG,
            // Leaving the game (the capture is dropped on unmount) closes the
            // judge; a consult not yet asked for then is never asked.
            (source, budget, seed) =>
                current() ? judge(source, budget, seed) : Promise.resolve(null),
            (done, total) => {
                if (current()) setVerdictJudging(gameId, done, total);
            },
            // The Plans stated during play: each proposal carries the one
            // in force at its decision (issue #10088).
            humanPlans(gameId)
        );
        // Why a game offers no review, or a shorter one than expected — to
        // Sentry as well as the console (issue #8732).
        reportProposalCounts(
            proposalCountsReport(gameId, list, tally, timings)
        );
        if (current()) setVerdictProposals(gameId, list);
    } catch (cause: unknown) {
        // A failed sample costs only questions, but it takes the post-game
        // review with it: loud, or nobody can tell why.
        reportSampleFailed(gameId, cause);
    } finally {
        close();
        if (current()) clearVerdictJudging(gameId);
        if (host.judge?.open === open) host.judge = null;
    }
}
