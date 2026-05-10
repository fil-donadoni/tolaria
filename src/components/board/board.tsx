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
import { preloadArtCropImages, preloadCardImages } from "~/lib/image-preload";
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
    showAllCards: boolean;
    debugAllActions: boolean;
};

export default function Board({
    gameId,
    playerId,
    solo,
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
        preloadCardImages(gameCardIds);
        preloadArtCropImages(gameCardIds);
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
    const turn = state.turn ?? 1;
    const pendingCast = state.pendingCast;
    const pendingActivation = state.pendingActivation;
    const autoPassPlayers = state.autoPassPlayers;
    const combat = state.combat;
    const pendingTarget = state.pendingTarget;
    const pendingChoices = state.pendingChoices;
    const mulligan = state.mulligan;
    const undoableBy = state.undoableBy;
    const gameOver = state.gameOver;
    const stackItems = state.stack ?? [];

    // In solo mode the single user controls both players: the viewer follows
    // whoever currently has priority (or whoever owns the next pending action).
    const viewerId = solo
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
                undoableBy,
                combat,
                gameOver,
                allPlayers,
                showAllCards,
                debugAllActions,
            }}
        >
            <SkipPhasePrefsContext value={skipPhasePrefs}>
                <div className="flex h-full w-full flex-col relative">
                    <AutoPassController solo={solo} />
                    {orderedPlayers.map((player) => (
                        <PlayerBoard key={player.id} player={player} />
                    ))}
                    <PhaseTracker />
                    {stackItems.length > 0 && <GameStack stack={stackItems} />}
                    <TargetArrowsOverlay stack={stackItems} />
                    {pendingTarget && pendingTarget.playerId === viewerId && (
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
                </div>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}
