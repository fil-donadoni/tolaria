// Client driver for the vs-AI Bot (ADR 0001, issues #109/#110).
//
// Watches the game FROM THE BOT'S OWN VIEWPOINT (a `getPublicState` query keyed
// to the bot seat, so the bot's hand is visible and the human's stays hidden —
// criterion 5), and whenever the bot owes an action it consults the Brain (in a
// Web Worker) for a random-legal move and replays it through existing mutations.
// Mirrors the auto-pass controller's shape: a short debounce, an in-flight
// guard, and a per-state-version signature so the same state never drives twice.
// The UI thread is never blocked — enumeration + selection live in the Worker,
// and submission is a normal async mutation sequence.

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicGameState } from "@convex/gameProjections";
import { consultBrain } from "~/lib/ai/brain-client";
import { decideBotAction, type BotView } from "~/lib/ai/brain";
import { executeMove, type MoveMutations } from "~/lib/ai/executor";

/** A small visible "thinking" beat before the bot acts, so the game does not
 *  feel like it is skipping the opponent's turn instantly. */
const THINK_DELAY_MS = 200;

/** The slim decision window the cheap main-thread gate reasons about — derived
 *  from the bot's projected state. Avoids a Worker round-trip on the many
 *  windows where the bot owes nothing. */
function buildBotView(state: PublicGameState, botId: string): BotView {
    const combat = state.combat;
    return {
        botId,
        phase: state.phase ?? "UPKEEP",
        priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
        activePlayerId: state.activePlayerId,
        hasCombat: combat !== undefined,
        attackersConfirmed: combat?.confirmed === true,
        blockersConfirmed: combat?.blockersConfirmed === true,
        mulliganDeclaringId: state.mulligan?.declaringPlayerId,
        mulliganBottoming: state.mulligan?.bottoming === true,
        gameOver: state.gameOver !== undefined,
    };
}

export function useVsAiDriver(gameId: Id<"games">, botId: string | null): void {
    const botState = useQuery(
        api.game.getPublicState,
        botId ? { gameId, playerId: botId } : "skip"
    );

    const mutations: MoveMutations = {
        playCard: useMutation(api.game.playCard),
        announceCast: useMutation(api.game.announceCast),
        selectTarget: useMutation(api.game.selectTarget),
        confirmTargets: useMutation(api.game.confirmTargets),
        tapForPayment: useMutation(api.game.tapForPayment),
        activateAbility: useMutation(api.game.activateAbility),
        tapForActivationPayment: useMutation(api.game.tapForActivationPayment),
        toggleAttacker: useMutation(api.game.toggleAttacker),
        confirmAttackers: useMutation(api.game.confirmAttackers),
        selectBlocker: useMutation(api.game.selectBlocker),
        assignBlockerTarget: useMutation(api.game.assignBlockerTarget),
        confirmBlockers: useMutation(api.game.confirmBlockers),
        declareMulligan: useMutation(api.game.declareMulligan),
        passPriority: useMutation(api.game.passPriority),
    };

    const inFlight = useRef(false);
    const lastSignature = useRef<string | null>(null);

    useEffect(() => {
        if (!botId || !botState) return;

        // Cheap main-thread gate: only consult the Worker when the bot actually
        // owes an action in this window.
        const view = buildBotView(botState, botId);
        if (decideBotAction(view).kind === "none") return;

        // De-dupe by state version: act at most once per distinct server state.
        // Unlike the pass-only bot, the bot may take several actions in one
        // priority window (play a land, then cast, then pass) — each bumps the
        // seq, so keying on seq lets the next action fire while still guarding
        // against double-submitting the same state.
        const signature = String(botState.seq);
        if (lastSignature.current === signature) return;

        const timer = window.setTimeout(() => {
            if (inFlight.current) return;
            inFlight.current = true;
            lastSignature.current = signature;
            void consultBrain(botState, botId)
                .then((move) =>
                    move
                        ? executeMove(move, { gameId, botId, mutations })
                        : undefined
                )
                .catch(() => {
                    // Stale/illegal submissions are rejected server-side; the
                    // next state change re-drives. Allow a retry of this state.
                    lastSignature.current = null;
                })
                .finally(() => {
                    inFlight.current = false;
                });
        }, THINK_DELAY_MS);

        return () => window.clearTimeout(timer);
        // `mutations` is rebuilt each render but its callables are stable; depend
        // on the state version and bot id only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameId, botId, botState]);
}
