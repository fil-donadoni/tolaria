// PROTOTYPE — throwaway (`?pv-target-arrow=C`). Reticle mode: no arrow chasing
// the cursor. The cursor itself becomes a crosshair, the source card lifts out
// of its row with a coloured outline, legal targets carry a quiet ring, and a
// SHORT arrow appears only once the reticle is over a legal target — the board
// stays readable while you aim.
import { useEffect } from "react";
import PrototypeTargetDefs, {
    PROTOTYPE_TARGET_LEGAL,
    PROTOTYPE_TARGET_LOCK,
    PROTOTYPE_TARGET_SOURCE,
} from "./prototype-target-defs";
import PrototypeTargetChip from "./prototype-target-chip";
import PrototypeTargetFilament from "./prototype-target-filament";
import PrototypeTargetRing from "./prototype-target-ring";
import { prototypeBoxContains } from "./prototype-target-geometry";
import {
    PROTOTYPE_TARGET_SVG_CLASS,
    type PrototypeTargetVariantProps,
} from "./prototype-target-variant-props";

const SHORT_ARROW = 130;

export default function PrototypeTargetArrowReticle({
    pointer,
    sources,
    targets,
}: PrototypeTargetVariantProps) {
    const hovered = pointer
        ? (targets.find((t) => prototypeBoxContains(t, pointer)) ?? null)
        : null;

    // Lift the real source card (individual transform properties, so the
    // card's own `transform` classes are left alone), restored on exit.
    const sourceKey = sources.map((s) => s.id).join(",");
    useEffect(() => {
        const els = sources.map((s) => s.el);
        const prev = els.map((el) => ({
            translate: el.style.translate,
            scale: el.style.scale,
            zIndex: el.style.zIndex,
        }));
        els.forEach((el) => {
            el.style.translate = "0 -14px";
            el.style.scale = "1.08";
            el.style.zIndex = "30";
        });
        return () =>
            els.forEach((el, i) => {
                el.style.translate = prev[i].translate;
                el.style.scale = prev[i].scale;
                el.style.zIndex = prev[i].zIndex;
            });
        // Keyed on WHICH cards are sources, not on every re-measure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceKey]);

    return (
        <>
            <style>{`[data-board-root], [data-board-root] * { cursor: crosshair !important; }`}</style>
            <svg className={PROTOTYPE_TARGET_SVG_CLASS}>
                <PrototypeTargetDefs />
                {sources.map((s) => (
                    <PrototypeTargetRing
                        key={s.id}
                        box={s}
                        color={PROTOTYPE_TARGET_SOURCE}
                        width={5}
                        pad={3}
                    />
                ))}
                {targets.map((t) => (
                    <PrototypeTargetRing
                        key={t.id}
                        box={t}
                        color={
                            t === hovered
                                ? PROTOTYPE_TARGET_LOCK
                                : PROTOTYPE_TARGET_LEGAL
                        }
                        width={t === hovered ? 5 : 3}
                        glow={t === hovered}
                    />
                ))}
                {hovered &&
                    sources.map((s) => {
                        const dx = hovered.center.x - s.center.x;
                        const dy = hovered.center.y - s.center.y;
                        const len = Math.hypot(dx, dy) || 1;
                        const k = Math.min(1, SHORT_ARROW / len);
                        return (
                            <PrototypeTargetFilament
                                key={s.id}
                                from={{
                                    x: hovered.center.x - dx * k,
                                    y: hovered.center.y - dy * k,
                                }}
                                to={hovered.center}
                                locked
                            />
                        );
                    })}
                {pointer && (
                    <g
                        transform={`translate(${pointer.x} ${pointer.y})`}
                        stroke={
                            hovered
                                ? PROTOTYPE_TARGET_LOCK
                                : PROTOTYPE_TARGET_SOURCE
                        }
                        strokeWidth={2}
                        fill="none"
                    >
                        <circle r={hovered ? 13 : 18} />
                        <path d="M-26,0 H-8 M8,0 H26 M0,-26 V-8 M0,8 V26" />
                    </g>
                )}
            </svg>
            {hovered && <PrototypeTargetChip box={hovered} active />}
        </>
    );
}
