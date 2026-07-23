/** Event isolation for every card-preview SURFACE (anchored pin, right-column
 *  dock, mobile long-press overlay).
 *
 *  All three surfaces are rendered with `createPortal` from inside
 *  `CardPreview`, which itself sits INSIDE the card instance's interaction
 *  subtree (`ActivatableAbilityMenu`'s `ContextMenuTrigger`, the hand card's
 *  cast `onClick`, the battlefield card's tap `onClick`). A React portal moves
 *  the DOM node but NOT the React event path: a click inside the panel still
 *  bubbles through the React tree to the card's handlers. So clicking the
 *  panel's own controls — the `Live text` / `Printed card` toggle — also
 *  synthesized the left-click `contextmenu` that opens the activated-ability
 *  menu (and tapped/cast the card), which is the bug this closes: the context
 *  menu must open from the CARD INSTANCE only, never from the preview area.
 *
 *  Native DOM listeners are unaffected — the panel is a `document.body` child,
 *  so the card-local native listeners in `CardPreview` / `CardTilt3D` never see
 *  these events anyway, and `CardPreview`'s outside-pointerdown dismiss is a
 *  document-level CAPTURE listener that runs before this stop.
 */
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export const previewSurfaceIsolationProps = {
    onClick: stop,
    onDoubleClick: stop,
    onMouseDown: stop,
    onMouseUp: stop,
    onPointerDown: stop,
    onPointerUp: stop,
    onContextMenu: stop,
    onTouchStart: stop,
    onTouchEnd: stop,
} as const;
