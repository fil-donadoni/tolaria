import { useState } from "react";

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
            // bottom-28 below md: the portrait bottom action bar (z-hud) is
            // shorter than the rail's z-100, so anchoring at bottom-4 parks the
            // rail ON TOP of the bar's left edge and eats its taps (phase
            // button, You tab). Desktop keeps the original bottom-4.
            className="fixed bottom-28 left-3 z-100 flex max-h-[calc(100vh-9rem)] flex-col items-start gap-2 overflow-y-auto text-xs md:bottom-4 md:max-h-[calc(100vh-2rem)]"
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
