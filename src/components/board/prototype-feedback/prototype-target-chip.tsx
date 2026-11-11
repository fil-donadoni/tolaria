// PROTOTYPE — throwaway (`?pv-target-arrow=B`). The floating label that names
// what picking this target DOES ("Attack Tamiyo", "Attack Opponent").
import type { PrototypeTargetBox } from "./prototype-target-geometry";

export default function PrototypeTargetChip({
    box,
    active,
}: {
    box: PrototypeTargetBox;
    active: boolean;
}) {
    // Above the target, or below it when there is no room (top nameplate).
    const below = box.y < 44;
    return (
        <div
            className={`absolute whitespace-nowrap rounded-full border px-3 py-1 font-semibold shadow-lg transition-all duration-150 ${
                active
                    ? "border-transparent bg-accent text-sm text-surface-base"
                    : "border-signal-target bg-surface-base/90 text-xs text-parchment"
            }`}
            style={{
                left: box.center.x,
                top: below ? box.y + box.h + 10 : box.y - 10,
                transform: `translate(-50%, ${below ? "0" : "-100%"}) scale(${active ? 1.08 : 1})`,
            }}
        >
            {box.label}
        </div>
    );
}
