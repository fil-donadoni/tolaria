import { CornerDownLeft, Keyboard, Space } from "lucide-react";
import type { ReactNode } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";

type HotkeyRow = { keys: (string | ReactNode)[]; label: string };

const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

const HOTKEYS: HotkeyRow[] = [
    {
        keys: [<Space className="w-3.5 h-3.5" aria-label="Space" />],
        label: "Pass priority / confirm",
    },
    {
        keys: [<CornerDownLeft className="w-3.5 h-3.5" aria-label="Enter" />],
        label: "Pass turn",
    },
    { keys: ["U"], label: "Undo / cancel cast" },
    { keys: [modKey, "click"], label: "Keep priority after casting" },
    { keys: ["Esc"], label: "Concede" },
];

export default function HotkeysLegend() {
    return (
        <Popover>
            <PopoverTrigger
                className="hidden rounded-sm border border-[var(--hairline-strong)] bg-surface-elevated p-2 text-sm text-text-muted shadow-lg transition-colors hover:text-text md:inline-flex"
                aria-label="Show hotkeys"
            >
                <Keyboard className="w-4 h-4" />
            </PopoverTrigger>
            <PopoverContent>
                <div className="mb-2 text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-text-muted">
                    Hotkeys
                </div>
                <div className="flex flex-col gap-1.5">
                    {HOTKEYS.map((row) => (
                        <div
                            key={row.label}
                            className="flex items-center gap-2"
                        >
                            <div className="flex gap-1">
                                {row.keys.map((k, i) => (
                                    <span key={i} className="inline-flex">
                                        {i > 0 && (
                                            <span className="mr-1 text-text-disabled">
                                                +
                                            </span>
                                        )}
                                        <kbd className="inline-flex items-center rounded-sm border border-[var(--hairline-strong)] bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text">
                                            {k}
                                        </kbd>
                                    </span>
                                ))}
                            </div>
                            <span className="text-text-muted">{row.label}</span>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
