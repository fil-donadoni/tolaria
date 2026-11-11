// PROTOTYPE — throwaway (`?pv-target-arrow=B`). Magnet + chips: the arrow never
// hangs in the air — it always points at the legal target NEAREST the cursor —
// and every legal target carries a chip naming the action. No dimming: the
// chips, not darkness, say where the choice is.
import PrototypeTargetDefs, {
    PROTOTYPE_TARGET_LEGAL,
    PROTOTYPE_TARGET_LOCK,
    PROTOTYPE_TARGET_SOURCE,
} from "./prototype-target-defs";
import PrototypeTargetChip from "./prototype-target-chip";
import PrototypeTargetFilament from "./prototype-target-filament";
import PrototypeTargetRing from "./prototype-target-ring";
import {
    prototypeBoxContains,
    prototypeNearestBox,
} from "./prototype-target-geometry";
import {
    PROTOTYPE_TARGET_SVG_CLASS,
    type PrototypeTargetVariantProps,
} from "./prototype-target-variant-props";

export default function PrototypeTargetArrowChips({
    pointer,
    sources,
    targets,
}: PrototypeTargetVariantProps) {
    const nearest = pointer
        ? prototypeNearestBox(targets, pointer)
        : (targets[0] ?? null);
    const onIt =
        !!nearest && !!pointer && prototypeBoxContains(nearest, pointer);
    return (
        <>
            <svg className={PROTOTYPE_TARGET_SVG_CLASS}>
                <PrototypeTargetDefs />
                {sources.map((s) => (
                    <PrototypeTargetRing
                        key={s.id}
                        box={s}
                        color={PROTOTYPE_TARGET_SOURCE}
                        width={4}
                    />
                ))}
                {targets.map((t) => (
                    <PrototypeTargetRing
                        key={t.id}
                        box={t}
                        color={
                            t === nearest
                                ? PROTOTYPE_TARGET_LOCK
                                : PROTOTYPE_TARGET_LEGAL
                        }
                        width={t === nearest ? 4 : 2}
                        glow={t === nearest}
                    />
                ))}
                {nearest &&
                    sources.map((s) => (
                        <PrototypeTargetFilament
                            key={s.id}
                            from={s.center}
                            to={nearest.center}
                            locked={onIt}
                        />
                    ))}
                {/* A thin tether shows the cursor is steering the magnet. */}
                {nearest && pointer && !onIt && (
                    <line
                        x1={pointer.x}
                        y1={pointer.y}
                        x2={nearest.center.x}
                        y2={nearest.center.y}
                        stroke={PROTOTYPE_TARGET_LOCK}
                        strokeWidth={1}
                        strokeDasharray="3 5"
                        opacity={0.5}
                    />
                )}
            </svg>
            {targets.map((t) => (
                <PrototypeTargetChip
                    key={t.id}
                    box={t}
                    active={t === nearest}
                />
            ))}
        </>
    );
}
