// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=`).
// Same gold filament vocabulary as the real `BoardArrows`, under its own ids.
export const PROTOTYPE_TARGET_SOURCE = "var(--color-signal-pending)";
export const PROTOTYPE_TARGET_LEGAL = "var(--color-signal-target)";
export const PROTOTYPE_TARGET_LOCK = "var(--color-signal-actionable-strong)";

export default function PrototypeTargetDefs() {
    return (
        <>
            <style>{`
@keyframes prototypeTargetPulse{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes prototypeTargetDash{to{stroke-dashoffset:-28}}
`}</style>
            <defs>
                <linearGradient
                    id="prototype-target-grad"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                >
                    <stop offset="0%" stopColor="var(--color-accent)" />
                    <stop
                        offset="100%"
                        stopColor="var(--color-accent-strong)"
                    />
                </linearGradient>
                <marker
                    id="prototype-target-head"
                    markerWidth="16"
                    markerHeight="16"
                    refX="11"
                    refY="7"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path
                        d="M0,1 L15,7 L0,13 Q5,7 0,1 Z"
                        fill="var(--color-accent-strong)"
                    />
                </marker>
            </defs>
        </>
    );
}
