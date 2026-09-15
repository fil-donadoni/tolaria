/** The ready marker of a Settled Screen (CONTEXT.md § Surfaces, issue #3644).
 *
 *  A walked surface renders this in the branch where its data HAS arrived —
 *  never in a loading branch — so `check:ui` (`scripts/ui-gate/settle.ts`)
 *  can tell a screen whose queries answered from a settled layout over a list
 *  that has not loaded yet. It is an attribute on an empty `hidden` span, not
 *  on the surface's root, because several roots are wrappers that forward no
 *  props (`LimitedEventPageFrame`, `DeckBuilderShell`): no box, no text,
 *  nothing a pointer, a screen reader or the occlusion probe can reach.
 *
 *  `scripts/__tests__/ui-gate-surface-ready.test.ts` reds when a walked route
 *  stops rendering it. */
export default function SurfaceReadyMarker() {
    return <span data-surface-ready="" hidden />;
}
