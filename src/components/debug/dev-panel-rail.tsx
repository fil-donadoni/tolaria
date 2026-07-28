import { useState } from "react";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";

/** Persisted collapse flag for the whole DEV rail. "1" = hidden. */
const HIDDEN_KEY = "tolaria:devRailHidden";

function readHidden(): boolean {
    try {
        return localStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
        return false;
    }
}

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
 * The rail itself collapses off the LEFT edge: the chevron toggle hides every
 * dev overlay, leaving only the small edge tab. The flag persists in
 * localStorage and nothing but the tab flips it, so a hidden rail NEVER
 * auto-opens (children are unmounted while hidden).
 *
 * Play-area layout rule (see `.play-area-center-x` in `src/index.css`): the rail
 * floats over the LEFT edge and must never reserve layout width or center on the
 * play area — the left side never affects centering. It is bottom-anchored and
 * grows upward, capped at the viewport height with its own scroll.
 *
 * Below `md` it anchors to the portrait bottom bar's MEASURED height
 * ({@link ABOVE_CONTROLLER_BAR}, #1759/#1764) rather than a hard-coded inset —
 * the bar's command row wraps (~106px one line, ~150px once DECLARE_ATTACKERS
 * pushes the side pills onto their own line), and a fixed `bottom-28` sat
 * correctly only for the one-line bar, letting the grown bar cover the rail's
 * own toggle tab. `max-h` tracks the same variable so the rail never grows
 * past the space actually left above the bar.
 *
 * Z-order (#1764): the rail sits at `z-dev-overlay` (45) — above the board/HUD
 * (40) so it stays usable, but below any bottom sheet or modal (50+). At the
 * old `z-100` it painted OVER an open phase sheet (`z-sheet`, 50) and ate taps
 * meant for the sheet's own controls.
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
    const [hidden, setHidden] = useState(readHidden);

    const toggle = () =>
        setHidden((v) => {
            const next = !v;
            try {
                localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
            } catch {
                // storage unavailable — session-only collapse is fine
            }
            return next;
        });

    return (
        <div
            data-dev-rail=""
            // Below md: anchored via the shared `ABOVE_CONTROLLER_BAR` class —
            // "just above the bar, whatever height it currently has" — instead
            // of the old fixed `bottom-28`, which sat correctly only for the
            // one-line bar. Desktop keeps the original bottom-4.
            className={`fixed ${ABOVE_CONTROLLER_BAR} left-3 z-dev-overlay flex max-h-[calc(100vh-var(--controller-bar-h,8rem)-2rem)] flex-col items-start gap-2 overflow-y-auto text-xs md:bottom-4 md:max-h-[calc(100vh-2rem)]`}
        >
            {!hidden && children}
            <button
                type="button"
                aria-label={hidden ? "Show dev panels" : "Hide dev panels"}
                aria-expanded={!hidden}
                onClick={toggle}
                className="rounded-md border border-border-subtle bg-black/70 px-1.5 py-1 font-mono text-[10px] text-text-muted shadow"
            >
                {hidden ? "» dev" : "«"}
            </button>
        </div>
    );
}
