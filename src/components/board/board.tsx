import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    SkipPhasePrefsContext,
    useSkipPhasePrefsState,
} from "~/hooks/useSkipPhasePreferences";
import {
    PendingChoiceBufferContext,
    usePendingChoiceBufferState,
} from "~/hooks/usePendingChoiceBuffer";
import {
    MinimizedChoiceContext,
    useMinimizedChoiceState,
} from "~/hooks/useMinimizedChoice";
import { preloadCardImages } from "~/lib/image-preload";
import { computeSoloViewerId } from "~/lib/priority";
import BoardNext from "./board-next";
import Controller from "./controller";
import AutoPassController from "./auto-pass-controller";
import GameOverDialog from "./game-over-dialog";
import PauseMenuDialog from "./pause-menu-dialog";
import TargetSelectionBanner from "./target-selection-banner";
import GraveyardTargetDialog from "./graveyard-target-dialog";
import { isGraveyardTargetForViewer } from "~/lib/graveyard-targets";
import PaymentBanner from "./payment-banner";
import PendingChoicePrompt from "./pending-choice-prompt";
import MinimizedChoiceIndicator from "./minimized-choice-indicator";
import MulliganPrompt from "./mulligan-prompt";
import ErrorToast from "./error-toast";
import VsAiDriver from "./vs-ai-driver";

const POPUP_SELECTORS = [
    '[data-slot="dialog-content"]',
    '[data-slot="popover-content"]',
    '[data-slot="context-menu-content"]',
].join(",");

type BoardProps = {
    gameId: Id<"games">;
    playerId: string;
    /** Solo (single-user) game: viewer auto-follows the priority player. */
    solo: boolean;
    /** vs-AI game (ADR 0001): the second seat is driven by the bot and the
     *  viewer stays pinned to the human's seat. */
    vsAi: boolean;
    showAllCards: boolean;
    debugAllActions: boolean;
};

export default function Board({
    gameId,
    playerId,
    solo,
    vsAi,
    showAllCards,
    debugAllActions,
}: BoardProps) {
    const pageVisible = usePageVisible();
    const skipPhasePrefs = useSkipPhasePrefsState();
    const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
    const publicState = useQuery(
        api.game.getPublicState,
        pageVisible && !showAllCards
            ? { gameId, playerId, debugAllActions }
            : "skip"
    );
    const fullState = useQuery(
        api.game.getFullState,
        pageVisible && showAllCards ? { gameId, debugAllActions } : "skip"
    );
    const state = showAllCards ? fullState : publicState;

    const gameCardIds = useQuery(
        api.game.getGameCardIds,
        pageVisible ? { gameId } : "skip"
    );
    useEffect(() => {
        if (!gameCardIds || gameCardIds.length === 0) return;
        // Art crops are only fetched when the user opens the zoom panel (hover
        // delay or `z` keypress) — preloading the entire deck's crops up front
        // adds ~3 MB of unused image traffic on first paint. Lazy fetch inside
        // CardPreview keeps initial LCP fast without harming zoom UX.
        preloadCardImages(gameCardIds);
    }, [gameCardIds]);

    const players = state?.players;
    const stack = state?.stack;
    useEffect(() => {
        if (!players) return;
        const ids: string[] = [];
        for (const p of players) {
            for (const c of p.battlefield) ids.push(c.card.id);
            for (const c of p.graveyard) ids.push(c.card.id);
            for (const c of p.exile) ids.push(c.card.id);
            for (const c of p.hand) if (c) ids.push(c.card.id);
            if (Array.isArray(p.library)) {
                for (const c of p.library) ids.push(c.card.id);
            } else {
                // ADR 0026 — preload art for the viewer's known library cards.
                for (const k of p.library.known ?? []) {
                    ids.push(k.card.card.id);
                }
            }
        }
        if (stack) for (const c of stack) ids.push(c.card.id);
        preloadCardImages(ids);
    }, [players, stack]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (state?.gameOver) return;
            if (document.querySelector(POPUP_SELECTORS)) return;
            e.preventDefault();
            setPauseMenuOpen(true);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [state?.gameOver]);

    // Client-side buffer for the active pending choice (ADR 0007). All four
    // click sites read from this single source via PendingChoiceBufferContext.
    // Hook must run unconditionally; passes through `undefined` choice while
    // state is still loading.
    const pendingChoiceBuffer = usePendingChoiceBufferState({
        gameId,
        playerId,
        activeChoice: state?.pendingChoices?.[0],
    });

    // Client-only per-choice minimize toggle for blocking choice dialogs
    // (issue #315). Shared by the banner and the library-pick modal so one
    // minimize collapses whichever surface the active choice uses. Resets when
    // the choice resolves; never persisted to GameState.
    const minimizedChoice = useMinimizedChoiceState(state?.pendingChoices?.[0]);

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers: Player[] = state.players;
    const activePlayerId = state.activePlayerId;
    const priorityPlayerId = state.priorityPlayerId ?? activePlayerId;
    const phase = state.phase ?? "UPKEEP";
    // CR 500.1: display the active player's own turn count, not the global
    // sequence number — extra turns (CR 500.7) bump the recipient normally.
    const activePlayer = state.players.find(
        (p) => p.id === state.activePlayerId
    );
    const turn = activePlayer?.turnsTaken ?? state.turn ?? 1;
    const pendingCast = state.pendingCast;
    const pendingActivation = state.pendingActivation;
    const autoPassPlayers = state.autoPassPlayers;
    const queuedEndTurn = state.queuedEndTurn;
    const combat = state.combat;
    const pendingTarget = state.pendingTarget;
    const pendingChoices = state.pendingChoices;
    const mulligan = state.mulligan;
    const gameOver = state.gameOver;
    const stackItems = state.stack ?? [];

    // In solo mode the single user controls both players: the viewer follows
    // whoever currently has priority (or whoever owns the next pending action).
    // In a vs-AI game the bot drives its own seat, so the viewer stays pinned to
    // the human's seat (ADR 0001) — never auto-following to the bot.
    const viewerId =
        solo && !vsAi
            ? computeSoloViewerId({
                  activePlayerId,
                  priorityPlayerId,
                  phase,
                  combat,
                  pendingCast,
                  pendingActivation,
                  pendingTarget,
                  pendingChoices,
                  playerIds: allPlayers.map((p) => p.id),
              })
            : playerId;

    // vs-AI: the bot is the seat the human does not control. The driver queries
    // the bot's own viewpoint and enumerates its moves (ADR 0001) — it only
    // needs the seat id from here.
    const botId = vsAi
        ? (allPlayers.find((p) => p.id !== playerId)?.id ?? null)
        : null;

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== viewerId);
    const me = allPlayers.find((p) => p.id === viewerId);
    const orderedPlayers = [opponent, me].filter(
        (p): p is Player => p !== undefined
    );

    return (
        <GameContext
            value={{
                gameId,
                playerId: viewerId,
                activePlayerId,
                priorityPlayerId,
                phase,
                turn,
                stackCount: stackItems.length,
                pendingCast,
                pendingActivation,
                pendingTarget,
                pendingChoices,
                autoPassPlayers,
                queuedEndTurn,
                combat,
                gameOver,
                allPlayers,
                showAllCards,
                debugAllActions,
            }}
        >
            <SkipPhasePrefsContext value={skipPhasePrefs}>
                <PendingChoiceBufferContext value={pendingChoiceBuffer}>
                    <MinimizedChoiceContext value={minimizedChoice}>
                        <main className="flex h-full w-full flex-col relative overflow-hidden">
                            <AutoPassController solo={solo} />
                            {vsAi && (
                                <VsAiDriver gameId={gameId} botId={botId} />
                            )}
                            <BoardNext
                                orderedPlayers={orderedPlayers}
                                stackItems={stackItems}
                            />
                            {pendingTarget &&
                                pendingTarget.playerId === viewerId &&
                                (isGraveyardTargetForViewer(
                                    pendingTarget,
                                    viewerId
                                ) ? (
                                    <GraveyardTargetDialog
                                        pendingTarget={pendingTarget}
                                        me={me}
                                        allPlayers={allPlayers}
                                        gameId={gameId}
                                        playerId={viewerId}
                                    />
                                ) : (
                                    <TargetSelectionBanner
                                        pendingTarget={pendingTarget}
                                        me={me}
                                        gameId={gameId}
                                        playerId={viewerId}
                                    />
                                ))}
                            {pendingCast &&
                                pendingCast.playerId === viewerId && (
                                    <PaymentBanner
                                        kind="cast"
                                        pendingCast={pendingCast}
                                        me={me}
                                        gameId={gameId}
                                        playerId={viewerId}
                                    />
                                )}
                            {pendingActivation &&
                                pendingActivation.playerId === viewerId && (
                                    <PaymentBanner
                                        kind="activation"
                                        pendingActivation={pendingActivation}
                                        me={me}
                                        gameId={gameId}
                                        playerId={viewerId}
                                    />
                                )}
                            {pendingChoices &&
                                pendingChoices.length > 0 &&
                                (minimizedChoice.isMinimized &&
                                pendingChoices[0].playerId === viewerId ? (
                                    <MinimizedChoiceIndicator
                                        choice={pendingChoices[0]}
                                    />
                                ) : (
                                    <PendingChoicePrompt
                                        choice={pendingChoices[0]}
                                        playerId={viewerId}
                                        gameId={gameId}
                                    />
                                ))}
                            {mulligan && !mulligan.bottoming && (
                                <MulliganPrompt
                                    gameId={gameId}
                                    viewerId={viewerId}
                                    mulligan={mulligan}
                                    allPlayers={allPlayers}
                                />
                            )}
                            <Controller
                                onOpenMenu={() => setPauseMenuOpen(true)}
                            />
                            {gameOver && (
                                <GameOverDialog
                                    gameOver={gameOver}
                                    allPlayers={allPlayers}
                                />
                            )}
                            <PauseMenuDialog
                                open={pauseMenuOpen}
                                onOpenChange={setPauseMenuOpen}
                                gameId={gameId}
                                playerId={viewerId}
                            />
                            <ErrorToast
                                error={pendingChoiceBuffer.lastError}
                                gameId={gameId}
                                onDismiss={pendingChoiceBuffer.dismissError}
                            />
                        </main>
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}
