/**
 * Keeps a click-anchored fixed menu on screen (issue #9166). The Pool menu
 * opens at the click point; with the larger default Booster the stacked Pool
 * sits at its floor height, near the viewport bottom, so a menu opened on a
 * low tile spilled past the edge and its last row (`Move to…`) was
 * unreachable. Pure: the caller measures the menu and the viewport.
 */
export function clampMenuPosition(
    anchor: { x: number; y: number },
    menu: { width: number; height: number },
    viewport: { width: number; height: number },
    margin = 8
): { x: number; y: number } {
    const maxX = viewport.width - menu.width - margin;
    const maxY = viewport.height - menu.height - margin;
    return {
        x: Math.max(margin, Math.min(anchor.x, maxX)),
        y: Math.max(margin, Math.min(anchor.y, maxY)),
    };
}
