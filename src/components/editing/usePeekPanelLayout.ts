import { useViewportMode } from "~/hooks/useViewportMode";

/** Bottom sheet (portrait) or right rail (landscape / tablet / desktop). */
export type PeekPanelLayout = "sheet" | "rail";

/** The rail's width and the sheet's reserved height. They live HERE, next to
 *  the resolver, because the panel is `fixed`: the surface underneath has to
 *  reserve exactly the room the panel occupies, and a surface that hard-codes
 *  its own copy of the number reserves the wrong amount the moment the panel
 *  changes. Both are consumed by `peek-panel.tsx` (to SIZE the panel) and by
 *  the adopting surface (to RESERVE for it). */
export const PEEK_PANEL_RAIL_WIDTH = "224px";
export const PEEK_PANEL_SHEET_RESERVE = "9rem";

/**
 * Which arrangement the Peek Panel takes (PRD #2405 D16, issue #2583).
 *
 * `useViewportMode`'s `"portrait"` is `(orientation: portrait) and
 * (max-width: 767px)` — a PHONE held upright and nothing else. Every other
 * regime (desktop, tablet in either orientation, phone in landscape) gets the
 * RAIL, which is why the reserve cannot be assumed to be vertical: at four of
 * the five UI-gate viewports the panel eats WIDTH, not height. Reserving
 * `paddingBottom` there leaves the rail occluding the right 224px of the
 * surface — the exact occlusion the five-viewport probe exists to catch.
 */
export function usePeekPanelLayout(
    override?: PeekPanelLayout
): PeekPanelLayout {
    const viewportMode = useViewportMode();
    return override ?? (viewportMode === "portrait" ? "sheet" : "rail");
}

/**
 * The padding an adopting surface must apply while the panel is open, on the
 * axis the RESOLVED layout actually occupies. Returned as a style object so
 * the surface can spread it (and so the axis it does NOT reserve stays
 * genuinely unset, which is what the guarding test asserts).
 */
export function peekPanelReserve(layout: PeekPanelLayout): {
    paddingRight?: string;
    paddingBottom?: string;
} {
    return layout === "rail"
        ? { paddingRight: PEEK_PANEL_RAIL_WIDTH }
        : { paddingBottom: PEEK_PANEL_SHEET_RESERVE };
}
