// PROTOTYPE — throwaway (`?pv-turn=B`). A turn-coloured frame, a large edge tab
// that SAYS whose turn it is, and a one-shot sweep across the board each time
// the turn changes hands (it travels toward the seat that now has the turn).
import {
    PROTOTYPE_TURN_OPPONENT,
    PROTOTYPE_TURN_SELF,
    prototypeTurnAlpha as alpha,
    usePrototypeTurnState,
} from "./use-prototype-turn-state";

const KEYFRAMES = `
@keyframes prototypeTurnSweepDown{0%{transform:translateY(-100%);opacity:0}15%{opacity:1}100%{transform:translateY(100vh);opacity:0}}
@keyframes prototypeTurnSweepUp{0%{transform:translateY(100vh);opacity:0}15%{opacity:1}100%{transform:translateY(-100%);opacity:0}}
@keyframes prototypeTurnAnnounce{0%{opacity:0;transform:translate(-50%,-50%) scale(.8)}18%{opacity:1;transform:translate(-50%,-50%) scale(1)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(1.06)}}
@keyframes prototypeTurnTabPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25)}}
`;

export default function PrototypeTurnFrameHandoff() {
    const { myTurn, priority, turn, activePlayerId } = usePrototypeTurnState();
    const color = myTurn ? PROTOTYPE_TURN_SELF : PROTOTYPE_TURN_OPPONENT;
    const label = myTurn ? "YOUR TURN" : "OPPONENT'S TURN";
    return (
        <div
            aria-hidden
            data-prototype-turn="B"
            className="pointer-events-none absolute inset-0 z-hud overflow-hidden"
        >
            <style>{KEYFRAMES}</style>
            <div
                className="absolute inset-0 transition-[box-shadow] duration-500"
                style={{
                    boxShadow: `inset 0 0 0 6px ${alpha(color, 90)}, inset 0 0 70px ${alpha(color, 32)}`,
                }}
            />
            {/* Edge tab on the mid-board line: readable without colour. */}
            <div
                className="absolute left-0 top-1/2 flex -translate-y-1/2 flex-col rounded-r-lg py-2 pl-3 pr-4 text-surface-base shadow-lg"
                style={{
                    background: color,
                    animation:
                        priority === "mine"
                            ? "prototypeTurnTabPulse 1.4s ease-in-out infinite"
                            : undefined,
                }}
            >
                <span className="text-[10px] font-semibold uppercase tracking-widest opacity-75">
                    Turn {turn}
                </span>
                <span className="text-base font-black uppercase leading-tight tracking-wide">
                    {label}
                </span>
                {priority !== "none" && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                        {priority === "mine"
                            ? "You act now"
                            : "Opponent is acting"}
                    </span>
                )}
            </div>
            {/* Handoff: remounted (and so replayed) on every turn change. */}
            <div key={`${activePlayerId}:${turn}`}>
                <div
                    className="absolute inset-x-0 top-0 h-40"
                    style={{
                        background: `linear-gradient(${myTurn ? "to bottom" : "to top"}, transparent, ${alpha(color, 55)} 70%, ${alpha(color, 95)})`,
                        animation: `${myTurn ? "prototypeTurnSweepDown" : "prototypeTurnSweepUp"} 900ms ease-in-out both`,
                    }}
                />
                <div
                    className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-xl px-8 py-3 text-4xl font-black uppercase tracking-widest text-surface-base shadow-2xl"
                    style={{
                        background: color,
                        animation: "prototypeTurnAnnounce 1500ms ease-out both",
                    }}
                >
                    {label}
                </div>
            </div>
        </div>
    );
}
