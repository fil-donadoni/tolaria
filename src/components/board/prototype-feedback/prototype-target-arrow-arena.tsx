// PROTOTYPE — throwaway (`?pv-target-arrow=A`). Arena-faithful: a curved arrow
// leaves the source and rides the cursor; over a legal target it snaps to the
// target's centre and thickens. Legal targets pulse, the source is ringed, and
// everything else on the board is dimmed.
import PrototypeTargetDefs, {
    PROTOTYPE_TARGET_LEGAL,
    PROTOTYPE_TARGET_LOCK,
    PROTOTYPE_TARGET_SOURCE,
} from "./prototype-target-defs";
import PrototypeTargetFilament from "./prototype-target-filament";
import PrototypeTargetRing from "./prototype-target-ring";
import { prototypeBoxContains } from "./prototype-target-geometry";
import {
    PROTOTYPE_TARGET_SVG_CLASS,
    type PrototypeTargetVariantProps,
} from "./prototype-target-variant-props";

export default function PrototypeTargetArrowArena({
    pointer,
    sources,
    targets,
}: PrototypeTargetVariantProps) {
    const hovered = pointer
        ? (targets.find((t) => prototypeBoxContains(t, pointer)) ?? null)
        : null;
    const tip = hovered?.center ?? pointer;
    return (
        <svg className={PROTOTYPE_TARGET_SVG_CLASS}>
            <PrototypeTargetDefs />
            <defs>
                <mask id="prototype-target-dim">
                    <rect
                        x="-2000"
                        y="-2000"
                        width="8000"
                        height="8000"
                        fill="white"
                    />
                    {[...sources, ...targets].map((b) => (
                        <rect
                            key={b.id}
                            x={b.x - 6}
                            y={b.y - 6}
                            width={b.w + 12}
                            height={b.h + 12}
                            rx={10}
                            fill="black"
                        />
                    ))}
                </mask>
            </defs>
            <rect
                x="-2000"
                y="-2000"
                width="8000"
                height="8000"
                fill="rgba(0,0,0,.55)"
                mask="url(#prototype-target-dim)"
            />
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
                        t === hovered
                            ? PROTOTYPE_TARGET_LOCK
                            : PROTOTYPE_TARGET_LEGAL
                    }
                    width={t === hovered ? 5 : 3}
                    pulse={t !== hovered}
                />
            ))}
            {tip &&
                sources.map((s) => (
                    <PrototypeTargetFilament
                        key={s.id}
                        from={s.center}
                        to={tip}
                        locked={!!hovered}
                    />
                ))}
        </svg>
    );
}
