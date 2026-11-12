// PROTOTYPE (zone-target highlight) — the veil of the hover focus: the whole
// board darkens AND blurs (owner feedback 2026-11-12: a plain dim left the
// overlapping cards of a pile reading as a stripy glitch) EXCEPT the focused
// relationship's source (stack row + source permanent) and its zone pile,
// cut out of a nonzero clip-path. The variant's own arrows and target
// cards render ABOVE this veil, so they stay sharp and lit.
import { createPortal } from "react-dom";
import type { Rect } from "./use-zone-target-model";

const PAD = 4;
const R = 8;

/** Rounded rectangle as a COUNTER-clockwise path: against the clockwise
 *  outer rect, the nonzero rule cuts it out. */
function roundRect(r: Rect): string {
    const x = r.x - PAD;
    const y = r.y - PAD;
    const w = r.w + PAD * 2;
    const h = r.h + PAD * 2;
    const k = Math.min(R, w / 2, h / 2);
    return `M ${x + k} ${y} A ${k} ${k} 0 0 0 ${x} ${y + k} V ${y + h - k} A ${k} ${k} 0 0 0 ${x + k} ${y + h} H ${x + w - k} A ${k} ${k} 0 0 0 ${x + w} ${y + h - k} V ${y + k} A ${k} ${k} 0 0 0 ${x + w - k} ${y} Z`;
}

export default function ProtoFocusLayer({ holes }: { holes: Rect[] }) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // A spell's row is both its row AND its source: the same rect twice would
    // wind -1 and fill the hole back in. Dedupe.
    const unique = Array.from(
        new Map(
            holes.map((r) => [
                `${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.w)}:${Math.round(r.h)}`,
                r,
            ])
        ).values()
    );
    const d = `M 0 0 H ${W} V ${H} H 0 Z ${unique.map(roundRect).join(" ")}`;
    // Portaled to <body> at z 100 (= z-modal), mounted on hover: later in the
    // DOM than the stack panel (also z-modal) so its unfocused rows veil too,
    // earlier than a card preview opened by that hover (also z-modal) so the
    // preview stays sharp. Context menus / popovers: z-modal-peak, above all.
    return createPortal(
        <div
            className="pointer-events-none fixed inset-0 z-[100]"
            style={{
                background: "rgb(0 0 0 / 0.55)",
                backdropFilter: "blur(5px) saturate(0.7)",
                WebkitBackdropFilter: "blur(5px) saturate(0.7)",
                clipPath: `path(nonzero, "${d}")`,
            }}
        />,
        document.body
    );
}
