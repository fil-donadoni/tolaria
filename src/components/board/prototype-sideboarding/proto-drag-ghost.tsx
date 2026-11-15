// PROTOTYPE — throwaway. The card under the pointer while dragging, with a
// live label saying what the drop will do ("1 copy → Sideboard" / "All 3 →").
import { createPortal } from "react-dom";
import ProtoCardImg from "./proto-card-img";
import type { DragInfo } from "./use-proto-drag";
import type { PoolRow } from "./proto-model";
import { cn } from "~/lib/utils";

export default function ProtoDragGhost({
    drag,
    row,
}: {
    drag: DragInfo;
    row: PoolRow;
}) {
    const here = drag.from === "main" ? row.main : row.side;
    const to = drag.from === "main" ? "Sideboard" : "Maindeck";
    const valid = drag.over !== null && drag.over !== drag.from;
    const all = here > 1 && (drag.overAll || drag.shift);
    const label = !valid
        ? `Drag to ${to}`
        : all
          ? `All ${here} → ${to}`
          : `1 copy → ${to}`;
    return createPortal(
        <div
            className="pointer-events-none fixed z-[1000] w-[120px]"
            style={{
                // flip to the finger's left near the right edge, so the card
                // and its label stay on screen
                left:
                    drag.x + 160 > window.innerWidth
                        ? drag.x - 138
                        : drag.x + 18,
                top: Math.min(drag.y + 14, window.innerHeight - 210),
            }}
        >
            <div
                className="relative rotate-[4deg] drop-shadow-[0_14px_22px_rgba(0,0,0,.65)]"
                style={{
                    boxShadow: all
                        ? Array.from(
                              { length: Math.min(here - 1, 3) },
                              (_, k) =>
                                  `${(k + 1) * 3}px ${(k + 1) * 3}px 0 -1px rgba(0,0,0,.6)`
                          ).join(",")
                        : undefined,
                    borderRadius: "4.5%",
                }}
            >
                <ProtoCardImg cardId={row.cardId} name={row.name} />
            </div>
            <div
                className={cn(
                    "mt-2 w-max rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-lg",
                    valid
                        ? "bg-accent text-surface-base"
                        : "bg-black/85 text-white ring-1 ring-white/30"
                )}
            >
                {label}
            </div>
        </div>,
        document.body
    );
}
