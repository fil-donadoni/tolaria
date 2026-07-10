import { useCallback, useState } from "react";
import type { Color, ManaCost } from "~/types/cards";
import { colors } from "~/types/cards";

const VIEWPORT_PAD = 8;

type ManaChoicePickerProps = {
    choices: ManaCost[];
    /** Anchor point (mouse coords). Omitted when the picker is opened without a
     *  pointer event (e.g. from the ability menu) — it then centres on screen
     *  instead of pinning to the top-left corner. */
    position?: { x: number; y: number };
    onSelect: (index: number) => void;
    onCancel: () => void;
};

// Clamp the picker's top-left so the panel never overflows the viewport. The
// desired anchor is the mouse point; we push it back inside whichever edge it
// crosses (pure layout, CR-agnostic).
function clampPosition(
    anchor: { x: number; y: number },
    width: number,
    height: number
): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(
        VIEWPORT_PAD,
        Math.min(anchor.x, vw - VIEWPORT_PAD - width)
    );
    const top = Math.max(
        VIEWPORT_PAD,
        Math.min(anchor.y, vh - VIEWPORT_PAD - height)
    );
    return { top, left };
}

export default function ManaChoicePicker({
    choices,
    position,
    onSelect,
    onCancel,
}: ManaChoicePickerProps) {
    const [placement, setPlacement] = useState<{
        top: number;
        left: number;
    } | null>(null);

    // Callback ref measures synchronously when the panel mounts, so the first
    // paint already sits inside the viewport. Only applies when anchored to a
    // pointer position — the centred variant fits by construction.
    const measureRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node || !position) return;
            const rect = node.getBoundingClientRect();
            setPlacement(clampPosition(position, rect.width, rect.height));
        },
        [position]
    );

    const style = position
        ? {
              left: placement?.left ?? position.x,
              top: placement?.top ?? position.y,
              maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
              opacity: placement ? 1 : 0,
          }
        : {
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
          };

    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onCancel} />
            <div
                ref={measureRef}
                className="fixed z-100 flex flex-col gap-1 overflow-y-auto rounded-lg bg-black/90 p-2 shadow-xl ring-1 ring-white/20"
                style={style}
            >
                {choices.map((cost, i) => {
                    // A choice may be a single pip ({B:2}) or a multi-colour
                    // combination ({U:1,B:1}). Expand every coloured pip so the
                    // button shows the full mana it produces, not just the first.
                    const pips: Color[] = colors.flatMap((c) =>
                        Array.from({ length: cost[c] ?? 0 }, () => c)
                    );
                    if (!pips.length) return null;
                    const title = `Add ${pips.map((c) => `{${c}}`).join("")}`;
                    return (
                        <button
                            key={i}
                            className="flex items-center justify-center gap-0.5 rounded-full bg-white/5 px-2 py-1 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15"
                            onClick={() => onSelect(i)}
                            title={title}
                        >
                            {pips.map((c, p) => (
                                <img
                                    key={p}
                                    src={`/img/symbols/${c}.svg`}
                                    alt={c}
                                    className="size-6 shrink-0"
                                />
                            ))}
                        </button>
                    );
                })}
            </div>
        </>
    );
}
