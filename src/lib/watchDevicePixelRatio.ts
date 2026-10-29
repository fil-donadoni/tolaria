/**
 * Calls `onChange` whenever `window.devicePixelRatio` changes WITHOUT a layout
 * change (issue #6940): the window dragged between a 1x and a 2x display, or
 * the browser zoomed. Neither fires a `ResizeObserver` on an element whose
 * CSS box did not move, so anything derived from the ratio — a card slot's
 * srcset floor (`useCardSlotFloor`) — goes stale until something else happens
 * to re-measure it.
 *
 * There is no `devicePixelRatio` event. The standard trick is a media query
 * pinned to the CURRENT ratio: `(resolution: Ndppx)` matches now and stops
 * matching the moment the ratio moves, which fires `change` once. The query is
 * then re-armed on the new ratio so the next move is seen too (a one-shot
 * listener would miss the drag back).
 *
 * Returns the disposer. A window without `matchMedia` (happy-dom builds that
 * stub it out, a test environment) gets a no-op and never a throw.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
    if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
    )
        return () => {};
    let query: MediaQueryList | null = null;
    const handle = () => {
        query?.removeEventListener("change", handle);
        arm();
        onChange();
    };
    const arm = () => {
        const dpr = window.devicePixelRatio || 1;
        query = window.matchMedia(`(resolution: ${dpr}dppx)`);
        query.addEventListener("change", handle);
    };
    arm();
    return () => query?.removeEventListener("change", handle);
}
