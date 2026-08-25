import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { CARD_TILT } from "~/lib/board-motion";
import { cardTiltFrame } from "~/lib/card-tilt-frame";

type CardTilt3DProps = {
    children: ReactNode;
    /** Hold the card flat and ignore pointer-driven tilt (e.g. while a hand card
     *  is being dragged, #271). The element stays mounted so any hover-zoom
     *  vehicle it wraps keeps its identity — only the tilt is suppressed. */
    suppressTilt?: boolean;
    /** Clockwise visual rotation, in degrees, applied to the card face BELOW
     *  this component — today only the battlefield's 90° tap rotation (#1994,
     *  issue #2551). Opt-in: at the default `0` every output is the legacy
     *  slot-frame one, so hand, pile and untapped-board callers need no change
     *  and behave identically. See `~/lib/card-tilt-frame`. */
    visualRotationDeg?: number;
};

/**
 * Arena-style 3D hover tilt + moving glare for a spatial-board card (PRD #249,
 * slice #253). Wraps a card's visuals and, on hover, tilts the inner element in
 * 3D toward the cursor with a radial glare that tracks the pointer, a forward
 * lift (`translateZ`) and a subtle scale. On pointer leave it eases back to flat
 * and fades the glare out.
 *
 * **Imperative, not stateful.** The tilt transform and glare gradient are
 * written directly to the element style on every `pointermove` — there is NO
 * per-frame React state, so re-renders never churn and the motion stays smooth.
 * The validated core (px,py in -0.5..0.5 from card center → rotateX/rotateY +
 * translateZ + scale; glare = radial-gradient at the pointer) is ported from the
 * throwaway prototype and parameterised by {@link CARD_TILT}.
 *
 * **Composes with the slot, doesn't fight it.** The tilt lives on an INNER
 * element (`[data-card-tilt]`); the outer slot (#251) carries the card's
 * placement transform and the `motion` FLIP layer (#252) carries cross-zone
 * animation. Because the tilt element is nested under both, its `rotateX/Y` +
 * `translateZ` compose on top of placement and spring transitions rather than
 * overwriting them — the spring zone-transitions are untouched.
 *
 * Text stays crisp: the card face is plain DOM (no blur, no persistent
 * sub-pixel scale that survives the reset), and the glare overlay is
 * `pointer-events-none` so it never blocks the underlying card's hover-zoom or
 * click handlers.
 *
 * **Follows the card's visual orientation, without moving in under it**
 * (issue #2551). A tapped permanent rotates a presentational layer 90° while
 * this component stays OUTSIDE it (the tilt root must not inherit that layer's
 * `pointer-events: none`, #1994 round 4). `visualRotationDeg` therefore tells
 * the tilt what rotation is applied beneath it and both outputs move into the
 * card's own frame: the pointer offset is read in the card's axes and the tilt
 * conjugated back into the slot's, and the glare overlay carries the SAME
 * rotation as the visual layer so its box coincides with the visible card face
 * (`~/lib/card-tilt-frame` carries the derivation).
 *
 * Accessibility: when the user prefers reduced motion the tilt and glare are
 * disabled entirely — the card renders flat and the pointer handlers are no-ops.
 */
export default function CardTilt3D({
    children,
    suppressTilt = false,
    visualRotationDeg = 0,
}: CardTilt3DProps) {
    const reduceMotion = useReducedMotion();
    const inert = reduceMotion || suppressTilt;
    const innerRef = useRef<HTMLDivElement>(null);
    const glareRef = useRef<HTMLDivElement>(null);

    // While suppressed (e.g. mid-drag) snap the inner element back to flat so
    // the rigid lift the parent applies isn't fighting a stale tilt transform.
    useEffect(() => {
        if (!suppressTilt) return;
        const inner = innerRef.current;
        if (inner) {
            inner.style.transition = "none";
            inner.style.transform =
                "rotateX(0deg) rotateY(0deg) translateZ(0px) scale(1)";
        }
        const glare = glareRef.current;
        if (glare) glare.style.opacity = "0";
    }, [suppressTilt]);

    const handlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (inert) return;
            const inner = innerRef.current;
            if (!inner) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            // Pointer offset from the card center, normalised to -0.5..0.5.
            const px = (e.clientX - rect.left) / rect.width - 0.5;
            const py = (e.clientY - rect.top) / rect.height - 0.5;
            // One derivation, both outputs: the tilt in the slot's axes (this
            // element is never rotated) and the glare in the card's own box.
            const { tiltXDeg, tiltYDeg, glareXPct, glareYPct } = cardTiltFrame({
                px,
                py,
                aspect: rect.width / rect.height,
                rotationDeg: visualRotationDeg,
                maxTiltDeg: CARD_TILT.maxTiltDeg,
            });
            inner.style.transition = CARD_TILT.moveTransition;
            inner.style.transform =
                `rotateX(${tiltXDeg.toFixed(2)}deg) ` +
                `rotateY(${tiltYDeg.toFixed(2)}deg) ` +
                `translateZ(${CARD_TILT.liftZ}px) ` +
                `scale(${CARD_TILT.hoverScale})`;
            const glare = glareRef.current;
            if (glare) {
                glare.style.opacity = String(CARD_TILT.glareOpacity);
                glare.style.background =
                    `radial-gradient(circle at ${glareXPct.toFixed(2)}% ` +
                    `${glareYPct.toFixed(2)}%, ` +
                    `rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 55%)`;
            }
        },
        [inert, visualRotationDeg]
    );

    const reset = useCallback(() => {
        const inner = innerRef.current;
        if (inner) {
            inner.style.transition = CARD_TILT.resetTransition;
            inner.style.transform =
                "rotateX(0deg) rotateY(0deg) translateZ(0px) scale(1)";
        }
        const glare = glareRef.current;
        if (glare) glare.style.opacity = "0";
    }, []);

    return (
        <div
            data-card-tilt-root
            className="relative w-full h-full card-corner"
            style={{ perspective: `${CARD_TILT.perspectivePx}px` }}
            onPointerMove={inert ? undefined : handlePointerMove}
            onPointerLeave={inert ? undefined : reset}
            // Suppress the native "Save image…" menu for tilt-wrapped cards
            // (hand + battlefield) at the ONE spot guaranteed to see the event.
            // `transform-style: preserve-3d` here + the inner `overflow-hidden`/
            // `contain: paint` art box flatten hit-testing, so the real
            // `contextmenu` can land on the flattened box OUTSIDE the card's
            // `CardPreview` handler subtree — a card-local `onContextMenu` then
            // misses it intermittently and the native menu wins. This root is an
            // ANCESTOR of every candidate target inside the tilt, so the bubbling
            // `contextmenu` always reaches it. preventDefault only cancels the
            // native menu — it does NOT stopPropagation, so a battlefield card's
            // Base UI ability context menu (a JS-driven ancestor) still opens.
            // Right-click preview stays a separate gesture on `CardPreview`.
            onContextMenu={(e) => e.preventDefault()}
        >
            <div
                ref={innerRef}
                data-card-tilt
                className="relative w-full h-full will-change-transform card-corner"
                style={{ transformStyle: "preserve-3d" }}
            >
                {children}
                {/* Glare highlight — tracks the pointer, fades on leave. Inert
                    so it never intercepts the card's click / hover-zoom.
                    `inset-0` is the same box the rotated visual layer starts
                    from, so carrying the SAME rotation makes the two coincide
                    exactly: right aspect, the card's own corner, covering the
                    rotated face's long-side overhang instead of the portrait
                    slot's short-side strips (#2551). The gradient centre is
                    then a percentage of the card's own box, which is precisely
                    what `cardTiltFrame` returns.

                    `card-corner`, not a fixed radius: the art box beneath is on
                    `--card-radius` since #2724, and a glare whose corner does
                    not match the art's shows as a bright wedge outside the
                    printed corner — the whole reason this box is not square.
                    The tilt maths (`cardTiltFrame`) is untouched: this changes
                    the glare's CLIP, never where its centre lands. */}
                <div
                    ref={glareRef}
                    data-card-glare
                    className="absolute inset-0 card-corner pointer-events-none mix-blend-overlay opacity-0"
                    style={
                        visualRotationDeg
                            ? { transform: `rotate(${visualRotationDeg}deg)` }
                            : undefined
                    }
                />
            </div>
        </div>
    );
}
