import { Modal } from "./Modal";
import { CONTROL_CLASS } from "../lib/controls";
import { closeSheet, SHORTCUTS, useSheetOpen } from "../lib/shortcuts";

/**
 * The list of keyboard shortcuts (#2635, ported in PRD #3148 S2).
 *
 * Rendered from the SAME `SHORTCUTS` array the keydown switch dispatches
 * from, so a key can never appear in one without the other.
 *
 * Reachable two ways, by design: `?`, and the header button — "reachable
 * without already knowing a shortcut" (#2635 AC). The Tab trap, the scrim,
 * `Escape` and the focus restore that this used to hand-roll (and that
 * `dialog.js` was extracted to share) all come from the primitive now.
 */
export function ShortcutsSheet() {
    const open = useSheetOpen();
    return (
        <Modal
            overlay="shortcuts"
            open={open}
            onClose={closeSheet}
            title="Keyboard shortcuts"
        >
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
                {SHORTCUTS.map((s) => (
                    <div key={s.key} className="contents">
                        <dt>
                            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono">
                                {s.key}
                            </kbd>
                        </dt>
                        <dd className="text-muted-foreground">{s.desc}</dd>
                    </div>
                ))}
            </dl>
            <button
                type="button"
                className={`${CONTROL_CLASS} self-end`}
                onClick={closeSheet}
            >
                Close
            </button>
        </Modal>
    );
}
