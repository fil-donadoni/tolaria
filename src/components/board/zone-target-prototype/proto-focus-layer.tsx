// PROTOTYPE (zone-target highlight) — the dim veil of the hover focus: the
// whole board darkens EXCEPT the focused relationship's source (stack row +
// source permanent) and its zone pile, cut out of an SVG mask. The variant's
// own arrows and target cards render ABOVE this veil, so they stay lit (the
// unfocused ones dim themselves).
import type { Rect } from "./use-zone-target-model";

const PAD = 4;

export default function ProtoFocusLayer({ holes }: { holes: Rect[] }) {
    return (
        <svg className="pointer-events-none fixed inset-0 z-[75] h-full w-full">
            <defs>
                <mask id="proto-zt-focus-mask">
                    <rect width="100%" height="100%" fill="white" />
                    {holes.map((r, i) => (
                        <rect
                            key={i}
                            x={r.x - PAD}
                            y={r.y - PAD}
                            width={r.w + PAD * 2}
                            height={r.h + PAD * 2}
                            rx={8}
                            fill="black"
                        />
                    ))}
                </mask>
            </defs>
            <rect
                width="100%"
                height="100%"
                fill="rgb(0 0 0 / 0.62)"
                mask="url(#proto-zt-focus-mask)"
                style={{ transition: "opacity 140ms ease" }}
            />
        </svg>
    );
}
