// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-turn=A|B|C`).
import { useGameContext } from "~/hooks/useGameContext";
import { computePriorityState, type PriorityState } from "~/lib/priority";

export type PrototypeTurnState = {
    /** The ACTIVE player is the viewer — the axis today's glow does not show. */
    myTurn: boolean;
    priority: PriorityState;
    turn: number;
    activePlayerId: string;
    gameOver: boolean;
};

export const PROTOTYPE_TURN_SELF = "var(--color-signal-self)";
export const PROTOTYPE_TURN_OPPONENT = "var(--color-signal-opponent)";
export const PROTOTYPE_TURN_PENDING = "var(--color-signal-pending)";

export const prototypeTurnAlpha = (color: string, pct: number) =>
    `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function usePrototypeTurnState(): PrototypeTurnState {
    const ctx = useGameContext();
    return {
        myTurn: ctx.activePlayerId === ctx.playerId,
        priority: computePriorityState(ctx),
        turn: ctx.turn,
        activePlayerId: ctx.activePlayerId,
        gameOver: !!ctx.gameOver,
    };
}
