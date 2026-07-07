import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { CARD_TILT } from "~/lib/board-motion";

type CardTilt3DProps = {
    children: ReactNode;
    /** Hold the card flat and ignore pointer-driven tilt (e.g. while a hand card
     *  is being dragged, #271). The element stays mounted so any hover-zoom
     *  vehicle it wraps keeps its identity — only the tilt is suppressed. */
    suppressTilt?: boolean;
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
 * Accessibility: when the user prefers reduced motion the tilt and glare are
 * disabled entirely — the card renders flat and the pointer handlers are no-ops.
 */
export default function CardTilt3D({
    children,
    suppressTilt = false,
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
            inner.style.transition = CARD_TILT.moveTransition;
            inner.style.transform =
                `rotateX(${(-py * CARD_TILT.maxTiltDeg).toFixed(2)}deg) ` +
                `rotateY(${(px * CARD_TILT.maxTiltDeg).toFixed(2)}deg) ` +
                `translateZ(${CARD_TILT.liftZ}px) ` +
                `scale(${CARD_TILT.hoverScale})`;
            const glare = glareRef.current;
            if (glare) {
                glare.style.opacity = String(CARD_TILT.glareOpacity);
                glare.style.background =
                    `radial-gradient(circle at ${((px + 0.5) * 100).toFixed(2)}% ` +
                    `${((py + 0.5) * 100).toFixed(2)}%, ` +
                    `rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 55%)`;
            }
        },
        [inert]
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
            className="relative w-full h-full"
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
                className="relative w-full h-full will-change-transform"
                style={{ transformStyle: "preserve-3d" }}
            >
                {children}
                {/* Glare highlight — tracks the pointer, fades on leave. Inert
                    so it never intercepts the card's click / hover-zoom. */}
                <div
                    ref={glareRef}
                    data-card-glare
                    className="absolute inset-0 rounded-sm pointer-events-none mix-blend-overlay opacity-0"
                />
            </div>
        </div>
    );
}
