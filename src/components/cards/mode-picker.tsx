import { createPortal } from "react-dom";
import type { SpellMode } from "@convex/cards/types";

type ModePickerProps = {
    modes: SpellMode[];
    position: { x: number; y: number };
    onSelect: (modeId: string) => void;
    onCancel: () => void;
};

/** Mode picker for modal spells (CR 700.2). Shown after the cast click on a
 *  card with `modes`; the chooser picks exactly one mode before announcement
 *  proceeds. The picker is purely UI — selection forwards the mode id to
 *  `announceCast` which validates server-side.
 *
 *  Rendered via a React portal to `document.body` because the hand cards
 *  use CSS transforms for the fan layout, and an ancestor `transform`
 *  reframes `position: fixed` to act like `position: absolute` relative to
 *  that ancestor (CSS containing-block spec). The portal escapes the
 *  transformed subtree so the picker positions against the viewport. */
export default function ModePicker({
    modes,
    position,
    onSelect,
    onCancel,
}: ModePickerProps) {
    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onCancel} />
            <div
                className="fixed z-50 flex min-w-64 flex-col gap-1 rounded-lg bg-black/90 p-2 shadow-xl ring-1 ring-white/20"
                style={{ left: position.x, top: position.y }}
            >
                {modes.map((mode) => (
                    <button
                        key={mode.id}
                        type="button"
                        className="flex flex-col items-start gap-0.5 rounded px-3 py-2 text-left text-sm text-white hover:bg-white/10 cursor-pointer"
                        onClick={() => onSelect(mode.id)}
                    >
                        <span className="font-semibold">{mode.label}</span>
                        <span className="text-xs text-white/70">
                            {mode.oracleText}
                        </span>
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}
