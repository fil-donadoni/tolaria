// PROTOTYPE — throwaway (`?pv-turn=A`). A thick frame keyed on the ACTIVE
// PLAYER (green = my turn, red = opponent's), with priority demoted to a thin
// inner ring: pulsing when I must act, steady amber when the opponent holds it.
import {
    PROTOTYPE_TURN_OPPONENT,
    PROTOTYPE_TURN_PENDING,
    PROTOTYPE_TURN_SELF,
    prototypeTurnAlpha as alpha,
    usePrototypeTurnState,
} from "./use-prototype-turn-state";

export default function PrototypeTurnFrameThick() {
    const { myTurn, priority } = usePrototypeTurnState();
    const color = myTurn ? PROTOTYPE_TURN_SELF : PROTOTYPE_TURN_OPPONENT;
    return (
        <div
            aria-hidden
            data-prototype-turn="A"
            className="pointer-events-none absolute inset-0 z-hud"
        >
            <style>{`@keyframes prototypeTurnInnerPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
            <div
                className="absolute inset-0 transition-[box-shadow] duration-500"
                style={{
                    boxShadow: `inset 0 0 0 7px ${alpha(color, 92)}, inset 0 0 28px 6px ${alpha(color, 55)}, inset 0 0 110px ${alpha(color, 30)}`,
                }}
            />
            {priority !== "none" && (
                <div
                    className="absolute inset-[11px] rounded-sm"
                    style={
                        priority === "mine"
                            ? {
                                  boxShadow: `inset 0 0 0 2px var(--color-signal-actionable), inset 0 0 18px ${alpha(PROTOTYPE_TURN_SELF, 60)}`,
                                  animation:
                                      "prototypeTurnInnerPulse 1.4s ease-in-out infinite",
                              }
                            : {
                                  boxShadow: `inset 0 0 0 2px ${alpha(PROTOTYPE_TURN_PENDING, 70)}`,
                              }
                    }
                />
            )}
        </div>
    );
}
