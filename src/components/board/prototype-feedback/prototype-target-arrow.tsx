// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=A|B|C`).
// "When I click an attacker and must choose what it attacks, nothing shows me
// the attacker or the legal targets" — Arena draws an arrow from the source to
// the cursor. Generic to ANY target choice: the same overlay serves the attack
// target (CR 508.1b) and a spell / ability target (CR 601.2c).
//
// Purely additive and read-only on the click path: the overlay is
// `pointer-events: none`, so every click still lands on the real card /
// nameplate and goes through the real handlers. It only adds Escape /
// right-click = cancel.
import { useRef } from "react";
import { usePrototypeVariant } from "~/components/prototype/prototype-switcher";
import PrototypeTargetArrowArena from "./prototype-target-arrow-arena";
import PrototypeTargetArrowChips from "./prototype-target-arrow-chips";
import PrototypeTargetArrowReticle from "./prototype-target-arrow-reticle";
import { usePrototypeTargetSession } from "./use-prototype-target-session";
import { usePrototypeTargetTracking } from "./use-prototype-target-tracking";

export default function PrototypeTargetArrow() {
    const variant = usePrototypeVariant("pv-target-arrow");
    const session = usePrototypeTargetSession();
    const ref = useRef<HTMLDivElement>(null);
    const live = variant ? session : null;
    const tracking = usePrototypeTargetTracking(live, ref);
    if (!live) return null;
    const props = { ...tracking, kind: live.kind };
    return (
        <div
            ref={ref}
            aria-hidden
            data-prototype-target-arrow={variant}
            className="pointer-events-none absolute inset-0"
            // Above the cards and the real arrows (60), below banners (70).
            style={{ zIndex: 66 }}
        >
            {variant === "B" ? (
                <PrototypeTargetArrowChips {...props} />
            ) : variant === "C" ? (
                <PrototypeTargetArrowReticle {...props} />
            ) : (
                <PrototypeTargetArrowArena {...props} />
            )}
        </div>
    );
}
