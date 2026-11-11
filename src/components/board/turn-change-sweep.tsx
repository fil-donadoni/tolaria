import { useEffect, useRef, useState } from "react";
import { useGameContext } from "~/hooks/useGameContext";

// One-shot turn announcement (#9160): a sweep toward the seat that now has the
// turn plus a centre label, replayed on every active-player change. The first
// render announces nothing (joining a game mid-turn is not a turn change).
// Motion is gated in CSS (`prefers-reduced-motion: no-preference`); otherwise
// the layer stays hidden.
export default function TurnChangeSweep() {
    const { activePlayerId, playerId, gameOver } = useGameContext();
    const prev = useRef(activePlayerId);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (prev.current === activePlayerId) return;
        prev.current = activePlayerId;
        setTick((t) => t + 1);
    }, [activePlayerId]);

    if (tick === 0 || gameOver) return null;
    const mine = activePlayerId === playerId;
    return (
        <div
            key={tick}
            aria-hidden
            data-testid="turn-change-sweep"
            data-turn-owner={mine ? "mine" : "opponent"}
            className="turn-sweep pointer-events-none absolute inset-0 z-hud overflow-hidden"
        >
            <div className="turn-sweep-band" />
            <div className="turn-sweep-label">
                {mine ? "Your turn" : "Opponent's turn"}
            </div>
        </div>
    );
}
