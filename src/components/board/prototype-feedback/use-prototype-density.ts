/* eslint-disable -- PROTOTYPE, throwaway branch */
// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-density=A|B|C`).
import { useEffect, useState } from "react";
import { usePrototypeVariant } from "~/components/prototype/prototype-switcher";
import {
    isPrototypeDensityVariant,
    PROTOTYPE_FOCUS_SHARE_COLLAPSED,
    PROTOTYPE_FOCUS_SHARE_EXPANDED,
    type PrototypeDensityVariant,
} from "./prototype-density-layout";

export type PrototypeDensity = {
    variant: PrototypeDensityVariant;
    backExpanded: boolean;
};

/** The active density variant for one battlefield zone, or null (= the real
 *  layout). For the focus band (C) it also tracks whether the pointer is over
 *  the zone's back strip — read off the zone's own box by `testId`, so the
 *  real `SpatialZone` needs no new prop. */
export function usePrototypeDensity(
    testId: string | undefined,
    mirror: boolean
): PrototypeDensity | null {
    const raw = usePrototypeVariant("pv-density");
    const variant = isPrototypeDensityVariant(raw) ? raw : null;
    const [backExpanded, setBackExpanded] = useState(false);

    useEffect(() => {
        if (variant !== "C" || !testId) {
            setBackExpanded(false);
            return;
        }
        const onMove = (e: PointerEvent) => {
            const el = document.querySelector(`[data-testid="${testId}"]`);
            if (!el) return;
            const r = el.getBoundingClientRect();
            const inside =
                e.clientX >= r.left &&
                e.clientX <= r.right &&
                e.clientY >= r.top &&
                e.clientY <= r.bottom;
            setBackExpanded((was) => {
                if (!inside) return false;
                // Hysteresis: once open, the strip is as tall as it is drawn.
                const creatureShare = was
                    ? PROTOTYPE_FOCUS_SHARE_EXPANDED
                    : PROTOTYPE_FOCUS_SHARE_COLLAPSED;
                // Back strip is the FAR side from the midline: bottom for the
                // viewer, top for the mirrored opponent.
                const frac = (e.clientY - r.top) / r.height;
                return mirror ? frac < 1 - creatureShare : frac > creatureShare;
            });
        };
        window.addEventListener("pointermove", onMove);
        return () => window.removeEventListener("pointermove", onMove);
    }, [variant, testId, mirror]);

    if (!variant) return null;
    return { variant, backExpanded: variant === "C" && backExpanded };
}
