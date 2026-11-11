// PROTOTYPE — throwaway (`?pv-turn=C`). The frame is cut at the mid-board line:
// the opponent's half (top) and mine (bottom). Only the ACTIVE seat's half is
// lit, so the frame points at whose turn it is; the idle half is a faint
// hairline. Priority shows as a bright bar on the outer edge of whoever must
// act — which can be the idle half (I respond during the opponent's turn).
import {
    PROTOTYPE_TURN_OPPONENT,
    PROTOTYPE_TURN_SELF,
    prototypeTurnAlpha as alpha,
    usePrototypeTurnState,
} from "./use-prototype-turn-state";

const KEYFRAMES = `@keyframes prototypeTurnEdgePulse{0%,100%{opacity:.45}50%{opacity:1}}`;

export default function PrototypeTurnFrameSplit() {
    const { myTurn, priority } = usePrototypeTurnState();
    const halves = [
        {
            side: "top" as const,
            color: PROTOTYPE_TURN_OPPONENT,
            active: !myTurn,
            acting: priority === "opponent",
        },
        {
            side: "bottom" as const,
            color: PROTOTYPE_TURN_SELF,
            active: myTurn,
            acting: priority === "mine",
        },
    ];
    return (
        <div
            aria-hidden
            data-prototype-turn="C"
            className="pointer-events-none absolute inset-0 z-hud"
        >
            <style>{KEYFRAMES}</style>
            {halves.map(({ side, color, active, acting }) => {
                const top = side === "top";
                // Fade the side rails out toward the midline so the two halves
                // never read as one continuous frame.
                const fade = `linear-gradient(${top ? "to bottom" : "to top"}, black 55%, transparent)`;
                return (
                    <div
                        key={side}
                        className={`absolute inset-x-0 h-1/2 transition-opacity duration-500 ${top ? "top-0" : "bottom-0"}`}
                        style={{ opacity: active ? 1 : 0.3 }}
                    >
                        <div
                            className="absolute inset-0"
                            style={{
                                borderStyle: "solid",
                                borderColor: alpha(color, active ? 95 : 70),
                                borderWidth: active ? 8 : 2,
                                [top ? "borderBottomWidth" : "borderTopWidth"]:
                                    0,
                                maskImage: fade,
                                WebkitMaskImage: fade,
                            }}
                        />
                        {active && (
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: `linear-gradient(${top ? "to bottom" : "to top"}, ${alpha(color, 38)}, transparent 55%)`,
                                }}
                            />
                        )}
                        {acting && (
                            <div
                                className={`absolute inset-x-0 h-[5px] ${top ? "top-[12px]" : "bottom-[12px]"}`}
                                style={{
                                    background: `linear-gradient(to right, transparent, var(--color-signal-actionable) 20%, var(--color-signal-actionable) 80%, transparent)`,
                                    boxShadow: `0 0 22px 4px ${alpha(color, 90)}`,
                                    animation:
                                        "prototypeTurnEdgePulse 1.3s ease-in-out infinite",
                                }}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
