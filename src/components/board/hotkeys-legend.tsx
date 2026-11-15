import { Keyboard } from "lucide-react";
import { Keycap } from "~/components/ui/keycap";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import { hotkeysForScope, type HotkeyScope } from "~/lib/hotkeys";

/** The hotkeys legend (issue #9833): every binding DECLARED live on this
 *  board, read from `~/lib/hotkeys` — the same rows the handlers match and
 *  the controls' keycaps draw. It used to be its own hand-written list, which
 *  could miss a new binding or advertise a dead one. */
export default function HotkeysLegend({
    scope = "board",
}: {
    /** The board the pod sits on: the GRE board's bindings or the Manual
     *  Board's (`ControllerState.hotkeyScope`). */
    scope?: HotkeyScope;
}) {
    const rows = hotkeysForScope(scope);
    return (
        <Popover>
            <PopoverTrigger
                className="hidden rounded-sm border border-border-strong bg-surface-elevated p-2 text-sm text-text-muted shadow-lg transition-colors hover:text-text md:inline-flex"
                aria-label="Show hotkeys"
            >
                <Keyboard className="w-4 h-4" />
            </PopoverTrigger>
            <PopoverContent>
                <div className="mb-2 text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-text-muted">
                    Hotkeys
                </div>
                <div className="flex flex-col gap-1.5">
                    {rows.map((row) => (
                        <div
                            key={row.label}
                            data-hotkey-row={row.label}
                            className="flex items-center gap-2"
                        >
                            <Keycap hotkey={row} />
                            <span className="text-text-muted">{row.label}</span>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
