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
import { preloadCardImages } from "~/lib/image-preload";
import { computeSoloViewerId } from "~/lib/priority";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import ActionBar from "./action-bar";
import AutoPassController from "./auto-pass-controller";
import GameOverDialog from "./game-over-dialog";
import PauseMenuDialog from "./pause-menu-dialog";
import TargetArrowsOverlay from "./target-arrows-overlay";
import TargetSelectionBanner from "./target-selection-banner";
import PaymentBanner from "./payment-banner";
import PendingChoicePrompt from "./pending-choice-prompt";
import MulliganPrompt from "./mulligan-prompt";
import ValidationToast from "./validation-toast";
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
                combat,
                gameOver,
                allPlayers,
                showAllCards,
                debugAllActions,
            }}
        >
            <SkipPhasePrefsContext value={skipPhasePrefs}>
                <PendingChoiceBufferContext value={pendingChoiceBuffer}>
                    <main className="flex h-full w-full flex-col relative">
                        <AutoPassController solo={solo} />
                        {vsAi && <VsAiDriver gameId={gameId} botId={botId} />}
                        {orderedPlayers.map((player) => (
                            <PlayerBoard key={player.id} player={player} />
                        ))}
                        <PhaseTracker />
                        {stackItems.length > 0 && (
                            <GameStack stack={stackItems} />
                        )}
                        <TargetArrowsOverlay stack={stackItems} />
                        {pendingTarget &&
                            pendingTarget.playerId === viewerId && (
                                <TargetSelectionBanner
                                    pendingTarget={pendingTarget}
                                    me={me}
                                    gameId={gameId}
                                    playerId={viewerId}
                                />
                            )}
                        {pendingCast && pendingCast.playerId === viewerId && (
                            <PaymentBanner
                                kind="cast"
                                pendingCast={pendingCast}
                                me={me}
                            />
                        )}
                        {pendingActivation &&
                            pendingActivation.playerId === viewerId && (
                                <PaymentBanner
                                    kind="activation"
                                    pendingActivation={pendingActivation}
                                    me={me}
                                />
                            )}
                        {pendingChoices && pendingChoices.length > 0 && (
                            <PendingChoicePrompt
                                choice={pendingChoices[0]}
                                playerId={viewerId}
                                gameId={gameId}
                            />
                        )}
                        {mulligan && !mulligan.bottoming && (
                            <MulliganPrompt
                                gameId={gameId}
                                viewerId={viewerId}
                                mulligan={mulligan}
                                allPlayers={allPlayers}
                            />
                        )}
                        <ActionBar onOpenMenu={() => setPauseMenuOpen(true)} />
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
                        <ValidationToast
                            message={pendingChoiceBuffer.lastError}
                            onDismiss={pendingChoiceBuffer.dismissError}
                        />
                    </main>
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}
