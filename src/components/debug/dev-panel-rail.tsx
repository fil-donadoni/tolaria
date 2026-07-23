/**
 * The single left-hand DEV rail (DEV builds only).
 *
 * Both dev overlays — the AI decision trace and the Debug panel — used to
 * anchor themselves independently (`top-1/2` and `bottom-4`), so a tall Debug
 * panel grew straight underneath the trace box and the two overlapped. This
 * rail is the ONE anchor: it owns the fixed positioning and stacks its children
 * in a column, so an overlap is impossible by construction. Each child keeps its
 * own collapse toggle and its own state — the rail only positions.
 *
 * Play-area layout rule (see `.play-area-center-x` in `src/index.css`): the rail
 * floats over the LEFT edge and must never reserve layout width or center on the
 * play area — the left side never affects centering. It is bottom-anchored and
 * grows upward, capped at the viewport height with its own scroll.
 *
 * `data-dev-rail` marks the subtree so the Debug panel's click-outside handler
 * can treat the whole rail as "inside" — clicking the trace box must not
 * dismiss the Debug panel.
 */
export default function DevPanelRail({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div
            data-dev-rail=""
            className="fixed bottom-4 left-3 z-100 flex max-h-[calc(100vh-2rem)] flex-col items-start gap-2 overflow-y-auto text-xs"
        >
            {children}
        </div>
    );
}
